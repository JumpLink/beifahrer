/**
 * The bridge: a WebSocket server on 127.0.0.1 that browsers running the beifahrer extension
 * connect to, and a `call()` that sends one request to one of them.
 *
 * Each agent session runs its own bridge on its own port of the range (ADR 0007, `listenInRange`),
 * and the extension keeps one socket per bridge. A bridge talks to browsers only: no other bridge
 * ever connects to it, so its protocol version and method set are its own and a session started
 * from an older bundle cannot hold back a newer one.
 *
 * Admission, in this order, before a connection may receive or send a single request:
 *   1. the peer address is loopback, and the handshake carries an extension Origin. Anything
 *      else, above all a web page (which always sends its Origin), is refused IN the handshake,
 *      before a socket exists;
 *   2. the first frame is a `hello` with a matching token (constant-time), within five seconds;
 *   3. the hello does not name THIS bridge as the one the person disconnected (`dismissed`).
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
  bindFirstFree,
  cleanSessionLabel,
  isExtensionOrigin,
  isLoopbackAddress,
  parseHello,
  parseResponse,
  tokensEqual,
  type AgentSession,
  type BridgeStatus,
  type ConnectedBrowser,
  type Hello,
  type Method,
  type Params,
  type PortRange,
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

/** What an MCP server needs from the browsers. */
export interface BrowserAccess {
  call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>>;
  status(): BridgeStatus;
}

interface Live extends BrowserConnection {
  socket: WebSocket;
  pending: PendingCalls;
}

export interface BridgeOptions {
  port: number;
  token: string;
  version: string;
  /** How the person sees this session in the popup. `setLabel` changes it later. */
  label?: string;
  /** Default per-call timeout. Writes wait for a person, so they get their own, longer one. */
  timeoutMs?: number;
  helloTimeoutMs?: number;
  /**
   * How long a call waits for a browser when none is connected. The extension finds a new bridge
   * within one probe round (≤ 5 s), so a session's first call should not fail for being early.
   */
  browserWaitMs?: number;
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
export const BROWSER_WAIT_MS = 7_000;
const WRITES: ReadonlySet<Method> = new Set(['page.fill', 'page.click', 'tabs.close']);

/** `page.wait` waits up to MAX_WAIT_MS in the browser; the call must outlive that. */
export const WAIT_TIMEOUT_MS = MAX_WAIT_MS + 15_000;

export function timeoutFor(method: Method, readTimeoutMs = DEFAULT_TIMEOUT_MS): number {
  if (method === 'page.wait') return Math.max(WAIT_TIMEOUT_MS, readTimeoutMs);
  return WRITES.has(method) ? WRITE_TIMEOUT_MS : readTimeoutMs;
}

export class Bridge extends EventEmitter implements BrowserAccess {
  #server: WebSocketServer | null = null;
  #live = new Map<string, Live>();
  #session: AgentSession;

  constructor(readonly options: BridgeOptions) {
    super();
    this.#session = {
      label: cleanSessionLabel(options.label) ?? 'beifahrer',
      pid: process.pid,
      instance: randomUUID(),
      startedAt: new Date().toISOString(),
    };
  }

  /** Resolves once listening; rejects with the listen error (the port is taken, most likely). */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: this.options.port,
        // Refused IN the handshake, before a socket exists: a web page that opens
        // ws://127.0.0.1 gets an HTTP 401/403 and never reaches the hello step, and neither does
        // a local process without an extension Origin.
        verifyClient: (info: { origin: string; req: { socket?: { remoteAddress?: string } } }) =>
          isLoopbackAddress(info.req?.socket?.remoteAddress) && isExtensionOrigin(info.origin),
      });
      const onError = (err: Error) => {
        server.close();
        reject(err);
      };
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        server.on('error', (err) => this.emit('error', err));
        listening.add(this);
        resolve();
      });
      server.on('connection', (socket) => this.#admit(socket));
      this.#server = server;
    });
  }

  async stop(): Promise<void> {
    for (const conn of this.#live.values()) conn.socket.close(CLOSE.shutdown, 'bridge stopping');
    const server = this.#server;
    this.#server = null;
    listening.delete(this);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get port(): number {
    const addr = this.#server?.address();
    return typeof addr === 'object' && addr ? addr.port : this.options.port;
  }

  get session(): AgentSession {
    return this.#session;
  }

  /**
   * Rename the session, e.g. once the MCP client has said who it is. Connected browsers hear it
   * at once; a label that cleans to nothing is ignored.
   */
  setLabel(label: string): void {
    const clean = cleanSessionLabel(label);
    if (!clean || clean === this.#session.label) return;
    this.#session = { ...this.#session, label: clean };
    for (const conn of this.#live.values()) {
      if (conn.socket.readyState === conn.socket.OPEN)
        conn.socket.send(JSON.stringify({ type: 'session', label: clean }));
    }
  }

  connections(): BrowserConnection[] {
    return [...this.#live.values()].map(({ id, hello, connectedAt }) => ({ id, hello, connectedAt }));
  }

  status(): BridgeStatus {
    return {
      port: this.port,
      version: this.options.version,
      session: this.#session,
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
    if (this.#live.size === 0) {
      // A session that just started may be a probe round ahead of the extension.
      await this.waitForConnection(this.options.browserWaitMs ?? BROWSER_WAIT_MS).catch(() => undefined);
    }
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

  #admit(socket: WebSocket): void {
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
      const hello = parseHello(raw);
      if (typeof hello === 'string') {
        const proto = (raw as { protocol?: unknown } | null)?.protocol;
        socket.close(proto !== PROTOCOL_VERSION ? CLOSE.protocol : CLOSE.unauthorized, hello);
        return;
      }
      if (!tokensEqual(hello.token, this.options.token)) {
        socket.close(CLOSE.unauthorized, 'wrong token');
        return;
      }
      // After the token: only a paired extension may learn that it had dismissed this bridge.
      if (hello.dismissed === this.#session.instance) {
        socket.close(CLOSE.dismissed, 'the person disconnected this session');
        return;
      }
      this.#admitBrowser(socket, hello);
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
      session: this.#session,
    };
    socket.send(JSON.stringify(welcome));
    socket.on('message', (frame) => this.#onFrame(conn, frame));
    socket.on('close', () => this.#drop(conn));
    this.emit('connected', { id: conn.id, hello, connectedAt: conn.connectedAt });
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
 * Start a bridge on the first free port of the range. Every agent session calls this; the
 * extension probes the whole range and connects to each bridge it finds.
 */
export async function listenInRange(range: PortRange, options: Omit<BridgeOptions, 'port'>): Promise<Bridge> {
  const { value } = await bindFirstFree(range, async (port) => {
    const bridge = new Bridge({ ...options, port });
    await bridge.start();
    return bridge;
  });
  return value;
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
        'no browser is connected to this beifahrer session. The person needs the extension installed and ' +
        'paired (`beifahrer token`), the browser open, and this session not disconnected in the popup. ' +
        'A session that just started is found within a few seconds.',
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
