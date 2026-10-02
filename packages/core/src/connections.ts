/**
 * The extension's table of bridge connections, one per port of the range (ADR 0007). Pure: no
 * sockets and no timers, the caller passes the time in. extension/src/bridge-client.ts owns the
 * sockets and asks this table which ports to probe, when, and what a close means.
 *
 * Per port, at most one of:
 *   (absent)     nothing answered last time; probed every round
 *   connecting   a socket is open or opening
 *   connected    welcomed; serves requests of that session
 *   refused      the bridge refused the token or the protocol version; retried with a growing
 *                pause (2 s up to 30 s), since a new bridge with the right token may take the
 *                port later — and a refusal can be a hiccup (a hello that came too late)
 * and, independently, a DISMISSAL: the person disconnected the session on that port. The port
 * is still probed, with the dismissed bridge instance in the hello; that bridge closes with
 * `CLOSE.dismissed`, any other one is welcome. A probe that finds nothing listening clears the
 * dismissal: the dismissed bridge is gone.
 *
 * Probing cadence: rounds, 1 s after a change, then one step slower per quiet round, up to 5 s.
 * Connecting to a closed loopback port fails at once, so a round over ten ports costs nothing,
 * and a new agent session is seen within five seconds. There is no give-up: a round always
 * follows the last one, so the start order of browser and bridge does not matter, and neither
 * does a bridge that restarts on the same port.
 *
 * Two states can outlive their peer without a close ever arriving — a socket that never finishes
 * its handshake (ADR 0001: a handshake that reaches the server and no `open` follows) and a
 * connected one whose bridge died without a close frame. Both would block their port for good,
 * since a port with an entry is not probed. `stalled` and `silent` name them; the caller drops
 * them and the port is probed again.
 */

import { CLOSE, type AgentSession, type Welcome } from './protocol.ts';
import { portsOf, type PortRange } from './ports.ts';

export const PROBE_STEPS_MS = [1_000, 2_000, 3_000, 4_000, 5_000] as const;
/** A port whose bridge refused the token is retried this often at most, not every round. */
export const REFUSED_RETRY_MS = 30_000;
/** The pauses before the 1st, 2nd, … retry of a refusal; the last one repeats (`REFUSED_RETRY_MS`). */
export const REFUSED_STEPS_MS = [2_000, 5_000, 10_000, REFUSED_RETRY_MS] as const;
/** A socket that is neither welcomed nor closed after this long is given up on. */
export const HANDSHAKE_MS = 10_000;
/** The extension pings every connected socket this often (it keeps an MV3 worker awake, too). */
export const PING_MS = 20_000;
/** A connected socket that sent nothing, not even a pong, for this long (> 2 pings) is dead. */
export const SILENCE_MS = 50_000;

export type PortEntry =
  | { state: 'connecting'; since: number }
  | {
      state: 'connected';
      connectionId: string;
      bridgeVersion: string;
      /** Null for a bridge older than ADR 0007, which does not say. */
      session: AgentSession | null;
      /** ms since the epoch. */
      since: number;
      /** When the bridge last sent anything (ms since the epoch). */
      heardAt: number;
    }
  | { state: 'refused'; reason: 'unauthorized' | 'protocol'; detail: string; retryAt: number };

/** One connected session, as the popup lists it. */
export interface SessionView {
  port: number;
  label: string;
  since: number;
  bridgeVersion: string;
  pid: number | null;
}

export type Overall = 'connected' | 'offline' | 'unauthorized' | 'protocol';

export interface CloseInfo {
  /** Whether the socket ever opened. A probe of a port nobody listens on never does. */
  opened: boolean;
  code: number;
  reason: string;
}

export class ConnectionTable {
  #ports = new Map<number, PortEntry>();
  /** port → the dismissed bridge's instance (null: an older bridge that has none). */
  #dismissed = new Map<number, string | null>();
  /** port → refusals in a row since it last welcomed us; picks the next pause. */
  #refusals = new Map<number, number>();
  #quietRounds = 0;
  #range: PortRange;

  constructor(range: PortRange) {
    this.#range = range;
  }

  get range(): PortRange {
    return this.#range;
  }

  /** A new range. Returns the ports that fell out of it; the caller closes their sockets. */
  setRange(range: PortRange): number[] {
    this.#range = range;
    const keep = new Set(portsOf(range));
    const dropped = [...this.#ports.keys()].filter((p) => !keep.has(p));
    for (const p of dropped) this.#ports.delete(p);
    for (const p of this.#dismissed.keys()) if (!keep.has(p)) this.#dismissed.delete(p);
    for (const p of this.#refusals.keys()) if (!keep.has(p)) this.#refusals.delete(p);
    this.#changed();
    return dropped;
  }

  /** The token changed: every refusal may be stale, every dismissal stays the person's choice. */
  resetRefusals(): void {
    for (const [port, entry] of this.#ports) if (entry.state === 'refused') this.#ports.delete(port);
    this.#refusals.clear();
    this.#changed();
  }

  entry(port: number): PortEntry | undefined {
    return this.#ports.get(port);
  }

  /** Ports to probe now: nothing open on them, and not a refusal still waiting for its retry. */
  due(now: number): number[] {
    return portsOf(this.#range).filter((port) => {
      const e = this.#ports.get(port);
      return !e || (e.state === 'refused' && e.retryAt <= now);
    });
  }

  /** When the next round starts, in ms from the end of this one. */
  nextRoundInMs(): number {
    return PROBE_STEPS_MS[Math.min(this.#quietRounds, PROBE_STEPS_MS.length - 1)]!;
  }

  /** A round ended. Without a change since, the next one waits a step longer. */
  roundDone(): void {
    this.#quietRounds++;
  }

  connecting(port: number, now = 0): void {
    this.#ports.set(port, { state: 'connecting', since: now });
  }

  /** Ports whose socket has been neither welcomed nor closed for `HANDSHAKE_MS`. */
  stalled(now: number): number[] {
    return [...this.#ports]
      .filter(([, e]) => e.state === 'connecting' && now - e.since >= HANDSHAKE_MS)
      .map(([port]) => port);
  }

  /** The bridge on `port` sent something (any frame, a pong included): it is alive. */
  heard(port: number, now: number): void {
    const e = this.#ports.get(port);
    if (e?.state === 'connected') e.heardAt = now;
  }

  /** Ports whose bridge was welcomed but has said nothing for `SILENCE_MS`: gone without a close. */
  silent(now: number): number[] {
    return [...this.#ports]
      .filter(([, e]) => e.state === 'connected' && now - e.heardAt >= SILENCE_MS)
      .map(([port]) => port);
  }

  /** What the hello to `port` must carry so a dismissed bridge refuses itself. */
  dismissedInstance(port: number): string | undefined {
    return this.#dismissed.get(port) ?? undefined;
  }

  /**
   * A bridge welcomed the extension. False when the extension must close the socket again: the
   * person dismissed an older bridge on this port that cannot recognise itself (no instance).
   */
  welcomed(port: number, welcome: Welcome, now: number): boolean {
    if (this.#dismissed.has(port)) {
      const instance = this.#dismissed.get(port);
      if (instance === null || instance === welcome.session?.instance) return false;
      this.#dismissed.delete(port);
    }
    this.#ports.set(port, {
      state: 'connected',
      connectionId: welcome.connectionId,
      bridgeVersion: welcome.bridge.version,
      session: welcome.session ?? null,
      since: now,
      heardAt: now,
    });
    this.#refusals.delete(port);
    this.#changed();
    return true;
  }

  /** The bridge renamed its session (the MCP client introduced itself). */
  relabelled(port: number, label: string): void {
    const e = this.#ports.get(port);
    if (e?.state === 'connected' && e.session) e.session = { ...e.session, label };
  }

  closed(port: number, info: CloseInfo, now: number): void {
    const was = this.#ports.get(port);
    this.#ports.delete(port);
    if (!info.opened) {
      // Nothing listens there: whatever the person dismissed on that port has exited.
      this.#dismissed.delete(port);
      return;
    }
    if (info.code === CLOSE.unauthorized || info.code === CLOSE.protocol) {
      const n = this.#refusals.get(port) ?? 0;
      this.#refusals.set(port, n + 1);
      this.#ports.set(port, {
        state: 'refused',
        reason: info.code === CLOSE.unauthorized ? 'unauthorized' : 'protocol',
        detail: info.reason,
        retryAt: now + REFUSED_STEPS_MS[Math.min(n, REFUSED_STEPS_MS.length - 1)]!,
      });
    }
    if (was?.state === 'connected') this.#changed();
  }

  /**
   * The person disconnects the session on `port`: it stays refused until its bridge exits. True
   * when there was a session; the caller then closes its socket.
   */
  dismiss(port: number): boolean {
    const e = this.#ports.get(port);
    if (e?.state !== 'connected') return false;
    this.#dismissed.set(port, e.session?.instance ?? null);
    return true;
  }

  sessions(): SessionView[] {
    const out: SessionView[] = [];
    for (const [port, e] of this.#ports) {
      if (e.state !== 'connected') continue;
      out.push({
        port,
        label: e.session?.label ?? `older bridge on port ${port}`,
        since: e.since,
        bridgeVersion: e.bridgeVersion,
        pid: e.session?.pid ?? null,
      });
    }
    return out.sort((a, b) => a.port - b.port);
  }

  /** The label of the session on `port`, for the activity log and the in-page pill. */
  labelOf(port: number): string | undefined {
    const e = this.#ports.get(port);
    return e?.state === 'connected' ? (e.session?.label ?? `port ${port}`) : undefined;
  }

  /** For the toolbar: connected if ANY session is; otherwise the most telling reason why not. */
  overall(): Overall {
    const entries = [...this.#ports.values()];
    if (entries.some((e) => e.state === 'connected')) return 'connected';
    if (entries.some((e) => e.state === 'refused' && e.reason === 'unauthorized')) return 'unauthorized';
    if (entries.some((e) => e.state === 'refused' && e.reason === 'protocol')) return 'protocol';
    return 'offline';
  }

  /** What a bridge said when it refused, for the status line. */
  refusalDetail(reason: 'unauthorized' | 'protocol'): string | undefined {
    for (const e of this.#ports.values()) if (e.state === 'refused' && e.reason === reason) return e.detail;
    return undefined;
  }

  #changed(): void {
    this.#quietRounds = 0;
  }
}
