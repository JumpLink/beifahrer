/**
 * The bridge: a WebSocket server on 127.0.0.1 that browsers running the beifahrer extension
 * connect to, and a `call()` that sends one request to one of them.
 *
 * The process that owns the port is the HUB. Besides extensions it admits AGENT PEERS: other
 * `beifahrer mcp` processes (parallel agent sessions) that found the port taken and relay their
 * calls through this one (ADR 0003, `shared.ts` for the peer side).
 *
 * Admission, in this order, before a connection may receive or send a single request:
 *   1. the peer address is loopback, and the handshake carries either an extension Origin or no
 *      Origin at all. Anything else — above all a web page, which always sends its Origin — is
 *      refused IN the handshake, before a socket exists;
 *   2. the first frame is a `hello` (extension) or an `agent-hello` (peer) with a matching token,
 *      within five seconds;
 *   3. the role fits the handshake: `hello` needs an extension Origin, `agent-hello` needs NO
 *      Origin (`roleAllowed`). A page can therefore never become an agent, and a local process
 *      without an Origin can never pose as a browser.
 *
 * The bridge holds no policy. Everything the agent may or may not do is decided in the browser;
 * this side only routes. That is deliberate: this is the process the agent talks to.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLOSE,
  MAX_WAIT_MS,
  PROTOCOL_VERSION,
  isLoopbackAddress,
  originKind,
  parseAgentRequest,
  parseFirstFrame,
  parseResponse,
  roleAllowed,
  tokensEqual,
  type AgentHello,
  type AgentReply,
  type AgentRequest,
  type AgentWelcome,
  type ConnectedBrowser,
  type Hello,
  type HubStatus,
  type Method,
  type OriginKind,
  type Params,
  type Result,
  type Welcome,
  type WireError,
} from '@beifahrer/core';

import { PendingCalls } from './pending.ts';

export interface BrowserConnection {
  id: string;
  hello: Hello;
  connectedAt: Date;
}

export class BridgeError extends Error {
  constructor(readonly wire: WireError) {
    super(wire.message);
  }
}

interface Live extends BrowserConnection {
  socket: WebSocket;
  pending: PendingCalls;
}

interface Peer {
  id: string;
  hello: AgentHello;
  socket: WebSocket;
}

export interface BridgeOptions {
  port: number;
  token: string;
  version: string;
  /** Default per-call timeout. Writes wait for a person, so they get their own, longer one. */
  timeoutMs?: number;
  helloTimeoutMs?: number;
}

/**
 * gjsify gap (unfixed, @gjsify/ws 0.52.0): its WebSocketServer has no GC guard, so once nothing in
 * JS references it, GJS collects it and the port silently stops listening after ~10 s (measured).
 * @gjsify/http and @gjsify/net keep an `_activeServers` set for exactly this; until ws does, the
 * bridge keeps itself alive while it listens. Delete this at the bump that carries the fix.
 */
const listening = new Set<Bridge>();

/** Writes can wait for the confirmation window, which gives the person two minutes. */
export const WRITE_TIMEOUT_MS = 135_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
const WRITES: ReadonlySet<Method> = new Set(['page.fill', 'page.click', 'tabs.close']);

/** `page.wait` waits up to MAX_WAIT_MS in the browser; the call must outlive that. */
export const WAIT_TIMEOUT_MS = MAX_WAIT_MS + 15_000;

export function timeoutFor(method: Method, readTimeoutMs = DEFAULT_TIMEOUT_MS): number {
  if (method === 'page.wait') return Math.max(WAIT_TIMEOUT_MS, readTimeoutMs);
  return WRITES.has(method) ? WRITE_TIMEOUT_MS : readTimeoutMs;
}

export class Bridge extends EventEmitter {
  #server: WebSocketServer | null = null;
  #live = new Map<string, Live>();
  #peers = new Map<string, Peer>();

  constructor(readonly options: BridgeOptions) {
    super();
  }

  /** Resolves once listening; rejects with the listen error (EADDRINUSE: another bridge is up). */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: this.options.port,
        // Refused IN the handshake, before a socket exists: a web page that opens
        // ws://127.0.0.1 gets an HTTP 401/403 and never reaches the hello step. "No Origin" gets
        // through here only to be held to the agent role after its first frame (#admit).
        verifyClient: (info: { origin: string; req: { socket?: { remoteAddress?: string } } }) =>
          isLoopbackAddress(info.req?.socket?.remoteAddress) && originKind(info.origin) !== 'page',
      });
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        server.on('error', (err) => this.emit('error', err));
        listening.add(this);
        resolve();
      });
      server.on('connection', (socket, req) => this.#admit(socket, handshakeOriginKind(req)));
      this.#server = server;
    });
  }

  async stop(): Promise<void> {
    for (const conn of this.#live.values()) conn.socket.close(CLOSE.shutdown, 'bridge stopping');
    for (const peer of this.#peers.values()) peer.socket.close(CLOSE.shutdown, 'hub stopping');
    const server = this.#server;
    this.#server = null;
    listening.delete(this);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get port(): number {
    const addr = this.#server?.address();
    return typeof addr === 'object' && addr ? addr.port : this.options.port;
  }

  connections(): BrowserConnection[] {
    return [...this.#live.values()].map(({ id, hello, connectedAt }) => ({ id, hello, connectedAt }));
  }

  /** Agent peers relaying through this hub right now. */
  peerCount(): number {
    return this.#peers.size;
  }

  status(): HubStatus {
    return {
      port: this.port,
      hub: { pid: process.pid, version: this.options.version, peers: this.#peers.size },
      browsers: this.connections().map(toConnectedBrowser),
    };
  }

  /** Wait until at least one browser is connected, or time out. */
  waitForConnection(timeoutMs: number): Promise<BrowserConnection> {
    const first = this.connections()[0];
    if (first) return Promise.resolve(first);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('connected', onConnected);
        reject(new Error(`no browser connected within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      const onConnected = (conn: BrowserConnection) => {
        clearTimeout(timer);
        resolve(conn);
      };
      this.once('connected', onConnected);
    });
  }

  /** Pick the connection a call goes to — see `resolveBrowser`. */
  resolve(browser?: string): BrowserConnection {
    return resolveBrowser(this.connections(), browser);
  }

  async call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>> {
    const target = this.resolve(browser);
    const conn = this.#live.get(target.id)!;
    if (!conn.hello.capabilities.includes(method)) {
      throw new BridgeError({ code: 'unsupported', message: `${label(conn)} cannot do ${method}` });
    }
    const timeoutMs = timeoutFor(method, this.options.timeoutMs);
    const { id, promise } = conn.pending.open<Result<M>>(
      timeoutMs,
      () =>
        new BridgeError({ code: 'timeout', message: `${method} got no answer within ${timeoutMs / 1000} s` }),
    );
    conn.socket.send(JSON.stringify({ type: 'request', id, method, params }));
    return promise;
  }

  #admit(socket: WebSocket, kind: OriginKind): void {
    const helloTimer = setTimeout(
      () => socket.close(CLOSE.unauthorized, 'no hello'),
      this.options.helloTimeoutMs ?? 5_000,
    );
    socket.once('message', (data) => {
      clearTimeout(helloTimer);
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        socket.close(CLOSE.protocol, 'not JSON');
        return;
      }
      const first = parseFirstFrame(raw);
      if (typeof first === 'string') {
        const proto = (raw as { protocol?: unknown } | null)?.protocol;
        socket.close(proto !== PROTOCOL_VERSION ? CLOSE.protocol : CLOSE.unauthorized, first);
        return;
      }
      // Before the token: a role that does not fit the handshake is refused whatever it carries.
      if (!roleAllowed(kind, first.role)) {
        socket.close(CLOSE.unauthorized, `${first.role} not allowed from this origin`);
        return;
      }
      if (!tokensEqual(first.hello.token, this.options.token)) {
        socket.close(CLOSE.unauthorized, 'wrong token');
        return;
      }
      if (first.role === 'agent') this.#admitPeer(socket, first.hello);
      else this.#admitBrowser(socket, first.hello);
    });
    socket.on('error', () => socket.terminate());
  }

  #admitBrowser(socket: WebSocket, hello: Hello): void {
    const conn: Live = {
      id: randomUUID().slice(0, 8),
      hello,
      connectedAt: new Date(),
      socket,
      pending: new PendingCalls(),
    };
    this.#live.set(conn.id, conn);
    const welcome: Welcome = {
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      bridge: { version: this.options.version },
      connectionId: conn.id,
    };
    socket.send(JSON.stringify(welcome));
    socket.on('message', (frame) => this.#onFrame(conn, frame));
    socket.on('close', () => this.#drop(conn));
    this.emit('connected', { id: conn.id, hello, connectedAt: conn.connectedAt });
  }

  #admitPeer(socket: WebSocket, hello: AgentHello): void {
    const peer: Peer = { id: randomUUID().slice(0, 8), hello, socket };
    this.#peers.set(peer.id, peer);
    const welcome: AgentWelcome = {
      type: 'agent-welcome',
      protocol: PROTOCOL_VERSION,
      bridge: { version: this.options.version, pid: process.pid },
      peerId: peer.id,
    };
    socket.send(JSON.stringify(welcome));
    socket.on('message', (frame) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(frame));
      } catch {
        return;
      }
      const req = parseAgentRequest(raw);
      if (!req) {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id === 'number') {
          send(socket, {
            type: 'agent-reply',
            id,
            ok: false,
            error: { code: 'invalid', message: 'not a valid agent request' },
          });
        }
        return;
      }
      void answerAgentRequest(req, this).then((reply) => send(socket, reply));
    });
    socket.on('close', () => {
      this.#peers.delete(peer.id);
      this.emit('peer-disconnected', peer.id);
    });
    this.emit('peer-connected', peer.id);
  }

  #onFrame(conn: Live, data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      return;
    }
    if ((raw as { type?: string } | null)?.type === 'ping') {
      conn.socket.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    const res = parseResponse(raw);
    if (!res) return;
    if (res.ok) conn.pending.resolve(res.id, res.result);
    else conn.pending.reject(res.id, new BridgeError(res.error));
  }

  #drop(conn: Live): void {
    this.#live.delete(conn.id);
    conn.pending.rejectAll(
      () => new BridgeError({ code: 'failed', message: `${label(conn)} disconnected before answering` }),
    );
    this.emit('disconnected', conn.id);
  }
}

/**
 * Is this listen error "the port is taken"?
 *
 * gjsify gap (unfixed, @gjsify/ws 0.52.0): on GJS the error carries no `code: 'EADDRINUSE'`, only a
 * LOCALISED Gio message ("Die Adresse wird bereits verwendet"). @gjsify/http maps it; ws does not
 * yet. The message check goes when ws carries the code.
 */
export function isAddressInUse(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e?.code === 'EADDRINUSE') return true;
  return (
    typeof e?.message === 'string' && /Gio\.IOErrorEnum/.test(e.message) && /127\.0\.0\.1:\d+/.test(e.message)
  );
}

/** A socket that closed while the hub worked on its request gets nothing; that is fine. */
function send(socket: WebSocket, frame: AgentReply): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
}

/**
 * Answer one peer request with what the hub would have answered its own agent. Errors travel
 * unchanged: a `forbidden` from the browser reaches the peer's agent as the same `forbidden`.
 */
export async function answerAgentRequest(
  req: AgentRequest,
  hub: {
    call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>>;
    status(): HubStatus;
  },
): Promise<AgentReply> {
  try {
    const result =
      req.type === 'agent-status' ? hub.status() : await hub.call(req.method, req.params, req.browser);
    return { type: 'agent-reply', id: req.id, ok: true, result };
  } catch (err) {
    const error: WireError =
      err instanceof BridgeError
        ? err.wire
        : { code: 'failed', message: err instanceof Error ? err.message : String(err) };
    return { type: 'agent-reply', id: req.id, ok: false, error };
  }
}

/**
 * Pick the connection a call goes to. With one browser connected, that one. With several, the
 * caller must say which — guessing would send a write to the wrong browser.
 */
export function resolveBrowser<C extends BrowserConnection>(all: C[], browser?: string): C {
  if (all.length === 0) {
    throw new BridgeError({
      code: 'failed',
      message:
        'no browser is connected to beifahrer. The person needs the extension installed and paired ' +
        '(`beifahrer token`), and the browser open.',
    });
  }
  if (!browser) {
    if (all.length === 1) return all[0]!;
    throw new BridgeError({
      code: 'invalid',
      message: `${all.length} browsers are connected — pass "browser" (one of: ${all.map(label).join(', ')}).`,
    });
  }
  const needle = browser.toLowerCase();
  const match = all.filter(
    (c) =>
      c.id === browser || c.hello.browser.family === needle || c.hello.browser.name.toLowerCase() === needle,
  );
  if (match.length === 1) return match[0]!;
  throw new BridgeError({
    code: match.length ? 'invalid' : 'not_found',
    message: match.length
      ? `"${browser}" matches ${match.length} connections — use the connection id: ${match.map(label).join(', ')}`
      : `no connected browser matches "${browser}" — connected: ${all.map(label).join(', ') || 'none'}`,
  });
}

export function toConnectedBrowser(c: BrowserConnection): ConnectedBrowser {
  return {
    id: c.id,
    browser: c.hello.browser,
    extension: c.hello.extension,
    capabilities: c.hello.capabilities,
    connectedAt: c.connectedAt.toISOString(),
  };
}

export function label(c: BrowserConnection): string {
  return browserLabel(toConnectedBrowser(c));
}

export function browserLabel(b: Pick<ConnectedBrowser, 'id' | 'browser'>): string {
  return `${b.browser.name} ${b.browser.version} (${b.id})`;
}

/**
 * The Origin of the handshake behind a new connection, as an `OriginKind`.
 *
 * gjsify gap (@gjsify/ws 0.52.0): `connection` hands over the raw `Soup.ServerMessage` instead of
 * a request with `headers`, so the header is read from whichever of the two shapes arrived. A
 * shape neither of them matches counts as `page`, the kind that is refused — fail closed.
 * `sec-websocket-origin` is what `ws` reads for protocol version 8; a client that sends only that
 * header must not look Origin-less here while `verifyClient` saw an Origin.
 */
export function handshakeOriginKind(req: unknown): OriginKind {
  const node = req as { headers?: Record<string, string | string[] | undefined> } | null;
  if (node?.headers && typeof node.headers === 'object') {
    const origin = node.headers.origin ?? node.headers['sec-websocket-origin'];
    return typeof origin === 'string' || origin === undefined ? originKind(origin) : 'page';
  }
  const soup = req as { get_request_headers?: () => { get_one(name: string): string | null } } | null;
  if (typeof soup?.get_request_headers === 'function') {
    const headers = soup.get_request_headers();
    return originKind(headers.get_one('Origin') ?? headers.get_one('Sec-WebSocket-Origin'));
  }
  return 'page';
}
