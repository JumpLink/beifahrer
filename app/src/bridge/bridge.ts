/**
 * The bridge: a WebSocket server on 127.0.0.1 that browsers running the beifahrer extension
 * connect to, and a `call()` that sends one request to one of them.
 *
 * Admission, in this order, before a connection may receive a single request:
 *   1. the handshake's Origin is an extension origin — a web page cannot forge that header, so a
 *      page opening ws://127.0.0.1 is refused with 403 before a socket even exists;
 *   2. the first frame is a `hello` with a matching token, within five seconds.
 *
 * The bridge holds no policy. Everything the agent may or may not do is decided in the browser;
 * this side only routes. That is deliberate: this is the process the agent talks to.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLOSE,
  PROTOCOL_VERSION,
  isExtensionOrigin,
  parseHello,
  parseResponse,
  tokensEqual,
  type Hello,
  type Method,
  type Params,
  type Result,
  type Welcome,
  type WireError,
} from '@beifahrer/core';

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
  pending: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >;
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
const WRITE_TIMEOUT_MS = 135_000;
const WRITES: ReadonlySet<Method> = new Set(['page.fill', 'page.click']);

export class Bridge extends EventEmitter {
  #server: WebSocketServer | null = null;
  #live = new Map<string, Live>();
  #nextId = 1;

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
        // ws://127.0.0.1 gets an HTTP 403 and never reaches the hello step.
        verifyClient: (info: { origin: string }) => isExtensionOrigin(info.origin),
      });
      const onError = (err: Error) => reject(err);
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

  connections(): BrowserConnection[] {
    return [...this.#live.values()].map(({ id, hello, connectedAt }) => ({ id, hello, connectedAt }));
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

  /**
   * Pick the connection a call goes to. With one browser connected, that one. With several, the
   * caller must say which — guessing would send a write to the wrong browser.
   */
  resolve(browser?: string): BrowserConnection {
    const all = this.connections();
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
        c.id === browser ||
        c.hello.browser.family === needle ||
        c.hello.browser.name.toLowerCase() === needle,
    );
    if (match.length === 1) return match[0]!;
    throw new BridgeError({
      code: match.length ? 'invalid' : 'not_found',
      message: match.length
        ? `"${browser}" matches ${match.length} connections — use the connection id: ${match.map(label).join(', ')}`
        : `no connected browser matches "${browser}" — connected: ${all.map(label).join(', ') || 'none'}`,
    });
  }

  async call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>> {
    const target = this.resolve(browser);
    const conn = this.#live.get(target.id)!;
    if (!conn.hello.capabilities.includes(method)) {
      return Promise.reject(
        new BridgeError({ code: 'unsupported', message: `${label(conn)} cannot do ${method}` }),
      );
    }
    const id = this.#nextId++;
    const timeoutMs = WRITES.has(method) ? WRITE_TIMEOUT_MS : (this.options.timeoutMs ?? 30_000);
    return new Promise<Result<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(
          new BridgeError({
            code: 'timeout',
            message: `${method} got no answer within ${timeoutMs / 1000} s`,
          }),
        );
      }, timeoutMs);
      conn.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      conn.socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
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
      const conn: Live = {
        id: randomUUID().slice(0, 8),
        hello,
        connectedAt: new Date(),
        socket,
        pending: new Map(),
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
    });
    socket.on('error', () => socket.terminate());
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
    const waiting = conn.pending.get(res.id);
    if (!waiting) return;
    conn.pending.delete(res.id);
    clearTimeout(waiting.timer);
    if (res.ok) waiting.resolve(res.result);
    else waiting.reject(new BridgeError(res.error));
  }

  #drop(conn: Live): void {
    this.#live.delete(conn.id);
    for (const [id, waiting] of conn.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(
        new BridgeError({ code: 'failed', message: `${label(conn)} disconnected before answering` }),
      );
      conn.pending.delete(id);
    }
    this.emit('disconnected', conn.id);
  }
}

export function label(c: BrowserConnection): string {
  return `${c.hello.browser.name} ${c.hello.browser.version} (${c.id})`;
}
