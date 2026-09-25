/**
 * One browser connection, shared by every agent session on this machine (ADR 0003).
 *
 * Each agent session starts its own `beifahrer mcp`, but only one process can own the loopback
 * port the extension connects to. Whoever binds it is the HUB (a plain `Bridge`); every other
 * process connects to the hub as an AGENT PEER and relays its calls over that socket. Leadership
 * is decided by the kernel — binding a port is atomic — so there is no election protocol to get
 * wrong. When the hub exits, its peers see the socket close, fail what was in flight, and race to
 * bind again; one wins, the others become its peers, and the extension, which retries on its own,
 * reconnects to the new hub.
 *
 * Nothing here holds policy either. A peer can do exactly what the hub's own agent can do — and
 * a local process with the token could just as well have bound the port first.
 */

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import {
  CLOSE,
  PROTOCOL_VERSION,
  parseAgentReply,
  parseAgentWelcome,
  type AgentHello,
  type AgentRequest,
  type HubStatus,
  type Method,
  type Params,
  type Result,
} from '@beifahrer/core';

import { Bridge, BridgeError, isAddressInUse, timeoutFor } from './bridge.ts';
import { PendingCalls } from './pending.ts';

/** What an MCP server needs from the browsers, wherever the socket to them lives. */
export interface BrowserAccess {
  call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>>;
  status(): Promise<BridgeStatus>;
}

export interface BridgeStatus extends HubStatus {
  /** Whether THIS process owns the port (`hub`) or relays through the one that does (`peer`). */
  role: 'hub' | 'peer';
  pid: number;
}

/** The hub answers a peer's call within its own timeout; this margin covers the relay. */
const RELAY_MARGIN_MS = 10_000;

/** A refusal by the hub that retrying cannot fix: the token or the protocol version differ. */
class HubRefused extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * The peer side of the relay: one socket to the hub. Emits `lost` once when that socket closes;
 * everything still waiting fails at that moment.
 */
export class HubClient extends EventEmitter {
  #pending = new PendingCalls();
  #closed = false;

  private constructor(
    readonly socket: WebSocket,
    readonly hubPid: number,
    readonly timeoutMs: number,
  ) {
    super();
    socket.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      const reply = parseAgentReply(raw);
      if (!reply) return;
      if (reply.ok) this.#pending.resolve(reply.id, reply.result);
      else this.#pending.reject(reply.id, new BridgeError(reply.error));
    });
    socket.on('close', () => {
      this.#closed = true;
      this.#pending.rejectAll(
        () =>
          new BridgeError({
            code: 'failed',
            message:
              `the beifahrer hub (pid ${hubPid}, another agent session) went away before answering. ` +
              'A write may or may not have reached the browser — check before repeating it. ' +
              'This session takes over the browser connection now; retry in a few seconds.',
          }),
      );
      this.emit('lost');
    });
  }

  /** Connect and pass admission. Rejects with `HubRefused` when the hub says no for good. */
  static connect(opts: {
    port: number;
    token: string;
    version: string;
    timeoutMs?: number;
    helloTimeoutMs?: number;
  }): Promise<HubClient> {
    return new Promise((resolve, reject) => {
      // No Origin, on purpose: that is what makes this an agent and not a browser to the hub.
      // Three-argument form and trailing `/`: @gjsify/ws 0.52.0 (AGENTS.md "gjsify gaps").
      const socket = new WebSocket(`ws://127.0.0.1:${opts.port}/`, undefined, {});
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.terminate();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new Error('the hub did not answer the hello')),
        opts.helloTimeoutMs ?? 5_000,
      );
      socket.on('open', () => {
        const hello: AgentHello = {
          type: 'agent-hello',
          protocol: PROTOCOL_VERSION,
          token: opts.token,
          agent: { version: opts.version, pid: process.pid },
        };
        socket.send(JSON.stringify(hello));
      });
      socket.once('message', (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(data));
        } catch {
          raw = null;
        }
        const welcome = parseAgentWelcome(raw);
        if (!welcome) return fail(new Error('the port answers, but not as a beifahrer hub'));
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners('close');
        socket.removeAllListeners('error');
        socket.on('error', () => undefined);
        resolve(new HubClient(socket, welcome.bridge.pid, opts.timeoutMs ?? 30_000));
      });
      socket.on('close', (code, reason) => {
        const why = String(reason || '') || `closed (${code})`;
        fail(
          code === CLOSE.unauthorized || code === CLOSE.protocol ? new HubRefused(code, why) : new Error(why),
        );
      });
      socket.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>> {
    return this.#request<Result<M>>(
      { type: 'agent-call', id: 0, method, params, ...(browser === undefined ? {} : { browser }) },
      timeoutFor(method, this.timeoutMs) + RELAY_MARGIN_MS,
    );
  }

  status(): Promise<HubStatus> {
    return this.#request<HubStatus>({ type: 'agent-status', id: 0 }, 5_000);
  }

  close(): void {
    this.socket.close(1000, 'peer stopping');
  }

  #request<T>(req: AgentRequest, timeoutMs: number): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new BridgeError({ code: 'failed', message: 'the beifahrer hub is gone' }));
    }
    const { id, promise } = this.#pending.open<T>(
      timeoutMs,
      () =>
        new BridgeError({
          code: 'timeout',
          message: `the beifahrer hub (pid ${this.hubPid}) did not answer within ${timeoutMs / 1000} s`,
        }),
    );
    this.socket.send(JSON.stringify({ ...req, id }));
    return promise;
  }
}

type Backend = { role: 'hub'; hub: Bridge } | { role: 'peer'; peer: HubClient };

export interface SharedBridgeOptions {
  port: number;
  token: string;
  version: string;
  timeoutMs?: number;
  /** Bind-or-connect rounds before an election gives up (each waits a little longer). */
  attempts?: number;
  log?: (message: string) => void;
}

/**
 * The object an MCP server holds: hub or peer, whichever the port allows, re-elected whenever
 * the hub it relied on disappears.
 */
export class SharedBridge implements BrowserAccess {
  #backend: Backend | null = null;
  #electing: Promise<Backend> | null = null;
  #stopped = false;

  constructor(readonly options: SharedBridgeOptions) {}

  /** The first election. Resolves with the role taken, rejects if neither bind nor relay worked. */
  async start(): Promise<'hub' | 'peer'> {
    return (await this.#ready()).role;
  }

  get role(): 'hub' | 'peer' | null {
    return this.#backend?.role ?? null;
  }

  async call<M extends Method>(method: M, params: Params<M>, browser?: string): Promise<Result<M>> {
    const backend = await this.#ready();
    return backend.role === 'hub'
      ? backend.hub.call(method, params, browser)
      : backend.peer.call(method, params, browser);
  }

  async status(): Promise<BridgeStatus> {
    const backend = await this.#ready();
    const status = backend.role === 'hub' ? backend.hub.status() : await backend.peer.status();
    return { ...status, role: backend.role, pid: process.pid };
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const backend = this.#backend;
    this.#backend = null;
    if (backend?.role === 'hub') await backend.hub.stop();
    else backend?.peer.close();
  }

  #ready(): Promise<Backend> {
    if (this.#backend) return Promise.resolve(this.#backend);
    this.#electing ??= this.#elect().finally(() => (this.#electing = null));
    return this.#electing;
  }

  async #elect(): Promise<Backend> {
    const { port, token, version, timeoutMs } = this.options;
    const attempts = this.options.attempts ?? 8;
    let last: unknown;
    let bindError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.#stopped) throw new BridgeError({ code: 'failed', message: 'beifahrer is stopping' });
      const hub = new Bridge({ port, token, version, timeoutMs });
      try {
        await hub.start();
        hub.on('error', (err: Error) => this.#log(`bridge error: ${err.message}`));
        hub.on('peer-connected', () => this.#log(`agent peer joined (${hub.peerCount()} relaying)`));
        hub.on('peer-disconnected', () => this.#log(`agent peer left (${hub.peerCount()} relaying)`));
        this.#log(`hub: bridge listening on 127.0.0.1:${hub.port}`);
        return this.#adopt({ role: 'hub', hub });
      } catch (err) {
        // Taken, most likely by a hub to relay through. Any other bind error is tried as a relay
        // too: on GJS "taken" is only recognisable from a localised message (isAddressInUse),
        // and a missed match must not cost this session the browser.
        bindError = err;
      }
      try {
        const peer = await HubClient.connect({ port, token, version, timeoutMs });
        peer.once('lost', () => this.#onLost(peer));
        this.#log(`peer: port ${port} is owned by beifahrer pid ${peer.hubPid}; relaying through it`);
        return this.#adopt({ role: 'peer', peer });
      } catch (err) {
        if (err instanceof HubRefused) {
          throw new BridgeError({
            code: 'failed',
            message:
              err.code === CLOSE.unauthorized
                ? `the beifahrer hub on port ${port} refused this session (${err.message}). ` +
                  'Every session must read the same token file (`beifahrer token` shows which).'
                : `the beifahrer hub on port ${port} speaks another protocol version (${err.message}). ` +
                  'Restart the older agent session.',
          });
        }
        last = err;
      }
      // The hub may be between exit and a successor's bind; step back and race again.
      await new Promise((r) => setTimeout(r, (attempt + 1) * 150 + Math.random() * 150));
    }
    if (bindError !== undefined && !isAddressInUse(bindError)) {
      throw new BridgeError({
        code: 'failed',
        message: `the bridge could not listen on 127.0.0.1:${port}: ${(bindError as Error).message}`,
      });
    }
    throw new BridgeError({
      code: 'failed',
      message:
        `port ${port} is taken, but not by a beifahrer hub this session can reach ` +
        `(${last instanceof Error ? last.message : String(last)}). Something else may hold the port — ` +
        'set BEIFAHRER_PORT (and the port in the extension options) to another one.',
    });
  }

  #adopt(backend: Backend): Backend {
    if (this.#stopped) {
      if (backend.role === 'hub') void backend.hub.stop();
      else backend.peer.close();
      throw new BridgeError({ code: 'failed', message: 'beifahrer is stopping' });
    }
    this.#backend = backend;
    return backend;
  }

  #onLost(peer: HubClient): void {
    if (this.#backend?.role !== 'peer' || this.#backend.peer !== peer) return;
    this.#backend = null;
    if (this.#stopped) return;
    this.#log(`peer: the hub (pid ${peer.hubPid}) went away; taking over or finding its successor`);
    // Right away, not on the next call: the extension can only reconnect once somebody listens.
    this.#ready().catch((err: Error) => this.#log(err.message));
  }

  #log(message: string): void {
    this.options.log?.(message);
  }
}
