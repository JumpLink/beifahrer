/**
 * The extension's side of the loopback sockets: ONE WebSocket PER agent session (ADR 0007).
 *
 * Every agent session runs its own bridge on a port of a small range. This file probes the range
 * in rounds, opens a socket to each port that answers, says hello with the pairing token, and
 * then serves that session's requests on that socket until it closes. A request arrives on a
 * socket and its answer goes back on the same one; sessions never see each other. Which ports to
 * probe, when, and what a close means is decided by `ConnectionTable` (core, pure, tested).
 *
 * Only 127.0.0.1 is ever probed: the URL below is built from a port number and nothing else.
 *
 * Two lifetimes to survive:
 * - MV2 (Firefox, Epiphany): a persistent background page. The round timer is enough.
 * - MV3 (Chromium): a service worker that the browser suspends after ~30 s without events. An
 *   open WebSocket that sees traffic keeps it alive (Chrome ≥ 116), hence a ping every 20 s on
 *   each socket. With no session running there is no traffic, the worker sleeps, and timers die
 *   with it, so an alarm wakes it to probe again.
 *
 * Start order does not matter, and nothing here ever gives up: the rounds go on while a token is
 * paired, whether a bridge exists or not, and a bridge that restarts (same port or another) is
 * found by the next round. Only the person's Disconnect keeps a bridge out, and only that
 * instance (`disconnectSession`). A socket that cannot close by itself — a handshake that never
 * ends, a bridge that died without a close frame — is dropped by the round, so its port is probed
 * again instead of waiting on it for good.
 */

import { browser } from '@wxt-dev/browser';
import {
  CLOSE,
  ConnectionTable,
  DEFAULT_PORT_RANGE,
  PING_MS,
  PROTOCOL_VERSION,
  cleanSessionLabel,
  isMethod,
  parseWelcome,
  splitFrame,
  type BridgeFrame,
  type Hello,
  type Overall,
  type PortRange,
  type Response,
  type SessionView,
} from '@beifahrer/core';
import { forgetDenials } from './access-prompt.ts';
import { rememberDesktop } from './accent.ts';
import { browserInfo, manifestVersion } from './browser-info.ts';
import { endSession, liveSessions } from './grants.ts';
import { MethodError, capabilities, runMethod, unsupportedReasons } from './handlers.ts';
import { loadSettings } from './settings.ts';

export type Status =
  | { state: 'unpaired' }
  | { state: Overall; range: PortRange; sessions: SessionView[]; detail?: string };

export const RECONNECT_ALARM = 'beifahrer-reconnect';
/** The close reason beside `CLOSE.personDisconnected`: short, and never read for anything else. */
const DISMISSED_REASON = 'dismissed';

const table = new ConnectionTable(DEFAULT_PORT_RANGE);
const sockets = new Map<number, WebSocket>();
/** port → ends that port's socket now, without waiting for the browser's close event. */
const dropSocket = new Map<number, (code: number, reason: string) => void>();
const pings = new Map<number, ReturnType<typeof setInterval>>();
/**
 * port → the extension's OWN id for the session connected there (ADR 0010). Session-bound grants
 * name it. Not the bridge's `connectionId`: that comes from the agent's side, and a bridge could
 * claim another session's id to borrow its grants.
 */
const sessionIds = new Map<number, string>();

/** The id of the session on `port`, for a grant "for this agent session" set from the popup. */
export function sessionIdOf(port: number): string | undefined {
  return sessionIds.get(port);
}

function endSessionOn(port: number): void {
  const id = sessionIds.get(port);
  if (!id) return;
  sessionIds.delete(port);
  forgetDenials(id);
  void endSession(id);
}
let token = '';
let roundTimer: ReturnType<typeof setTimeout> | undefined;
let probing = false;

const statusListeners = new Set<() => void>();

/** Called on every status change; the toolbar button repaints from it (toolbar.ts). */
export function onStatusChange(fn: () => void): void {
  statusListeners.add(fn);
}

function changed(): void {
  for (const fn of statusListeners) fn();
}

export function currentStatus(): Status {
  if (!token) return { state: 'unpaired' };
  const state = table.overall();
  const detail = state === 'protocol' ? table.refusalDetail('protocol') : undefined;
  return { state, range: table.range, sessions: table.sessions(), ...(detail ? { detail } : {}) };
}

function send(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

/** A response may be megabytes (screenshots); the bridge's socket closes at 128 KiB per message. */
function sendResponse(ws: WebSocket, response: Response): void {
  for (const piece of splitFrame(response.id, JSON.stringify(response))) {
    if (ws.readyState === WebSocket.OPEN) ws.send(piece);
  }
}

async function serve(
  ws: WebSocket,
  port: number,
  id: number,
  method: unknown,
  params: unknown,
): Promise<void> {
  let response: Response;
  if (!isMethod(method)) {
    response = {
      type: 'response',
      id,
      ok: false,
      error: { code: 'invalid', message: `unknown method ${String(method)}` },
    };
  } else {
    try {
      const result = await runMethod(method, params, {
        session: table.labelOf(port),
        sessionId: sessionIds.get(port),
      });
      response = { type: 'response', id, ok: true, result };
    } catch (err) {
      response = {
        type: 'response',
        id,
        ok: false,
        error:
          err instanceof MethodError
            ? err.wire
            : { code: 'failed', message: String((err as Error)?.message ?? err) },
      };
    }
  }
  sendResponse(ws, response);
}

function probe(port: number): void {
  table.connecting(port, Date.now());
  let opened = false;
  let settled = false;
  // Loopback only, by construction: the host is a literal, the port a number from the range.
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  } catch {
    // Not even a socket: the port stays free for the next round, not stuck in "connecting".
    table.closed(port, { opened: false, code: 1006, reason: '' }, Date.now());
    return;
  }
  sockets.set(port, ws);
  ws.onclose = (event) => settle(event.code, event.reason);

  ws.onopen = async () => {
    opened = true;
    const dismissed = table.dismissedInstance(port);
    const reasons = unsupportedReasons();
    const hello: Hello = {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      browser: await browserInfo(),
      extension: { version: browser.runtime.getManifest().version, manifestVersion: manifestVersion() },
      capabilities: capabilities(),
      // Present only when something is missing, so a browser that serves everything sends the
      // same hello it always did (issue #31).
      ...(Object.keys(reasons).length ? { unsupported: reasons } : {}),
      ...(dismissed ? { dismissed } : {}),
    };
    send(ws, hello);
  };

  /**
   * The socket is over — the browser said so, or the round gave up on it. Once only; a socket
   * that was replaced or already settled changes nothing.
   */
  function settle(code: number, reason: string): void {
    if (settled) return;
    settled = true;
    clearInterval(pings.get(port));
    pings.delete(port);
    if (sockets.get(port) !== ws) return;
    // The session's grants end with its connection, whatever closed it.
    endSessionOn(port);
    sockets.delete(port);
    dropSocket.delete(port);
    table.closed(port, { opened, code, reason }, Date.now());
    changed();
    // A session that went away may come back at once (a restart): look again soon.
    if (opened && code !== CLOSE.dismissed) schedule(table.nextRoundInMs());
  }
  dropSocket.set(port, (code, reason) => {
    ws.onmessage = ws.onopen = null;
    settle(code, reason);
    try {
      ws.close(1000, reason);
    } catch {
      // Already closed; settled above.
    }
  });

  ws.onmessage = (event) => {
    table.heard(port, Date.now());
    let frame: BridgeFrame;
    try {
      frame = JSON.parse(String(event.data)) as BridgeFrame;
    } catch {
      return; // not JSON — not a bridge speaking; ignore rather than crash the worker
    }
    if (frame.type === 'welcome') {
      const welcome = parseWelcome(frame);
      if (!welcome || !table.welcomed(port, welcome, Date.now())) {
        // The person dismissed an older bridge on this port. Same message to the bridge as the
        // popup's Disconnect (CLOSE.personDisconnected): it is the same decision, so an agent
        // waiting on a call hears the same words.
        ws.close(CLOSE.personDisconnected, DISMISSED_REASON);
        return;
      }
      endSessionOn(port);
      const id = crypto.randomUUID();
      sessionIds.set(port, id);
      liveSessions.add(id);
      clearInterval(pings.get(port));
      pings.set(
        port,
        setInterval(() => send(ws, { type: 'ping' }), PING_MS),
      );
      void rememberDesktop(welcome.desktop);
      changed();
    } else if (frame.type === 'request') {
      void serve(ws, port, frame.id, frame.method, frame.params);
    } else if (frame.type === 'session') {
      const label = cleanSessionLabel(frame.label);
      if (label) {
        table.relabelled(port, label);
        changed();
      }
    } else if (frame.type === 'desktop') {
      void rememberDesktop(frame.desktop);
    }
  };
}

function closeAll(reason: string): void {
  for (const ws of sockets.values()) ws.close(1000, reason);
}

/**
 * Ask a silent socket whether it is still there, so a healthy one is never dropped: an MV3 worker
 * that slept looks exactly like a dead bridge, because the ping timer slept with it.
 */
function ask(port: number, now: number): void {
  const ws = sockets.get(port);
  // No socket at all is nothing to ask and nothing to wait for, so nothing to keep the port for.
  if (!ws) return dropSocket.get(port)?.(1006, 'no sign of life');
  send(ws, { type: 'ping' });
  table.asked(port, now);
}

function schedule(ms: number): void {
  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => void connect(), ms);
}

/**
 * One probe round over the range, then the next one is scheduled. Safe to call any time.
 *
 * The next round is scheduled in a `finally`: whatever goes wrong in this one (storage failing, a
 * socket that cannot be opened), the chain of rounds must not end with it — a chain that died
 * quietly looked, from the person's side, like an extension that never reconnects.
 */
export async function connect(): Promise<void> {
  if (probing) return;
  probing = true;
  clearTimeout(roundTimer);
  let paired = true;
  try {
    const settings = await loadSettings();
    if (settings.token !== token) {
      // Another token: every open socket was admitted with the old one.
      token = settings.token;
      table.resetRefusals();
      closeAll('pairing changed');
    }
    if (!token) {
      paired = false;
      changed();
      return; // storage.onChanged starts probing once the person pastes a token
    }
    const range = { base: settings.port, count: settings.portCount };
    if (range.base !== table.range.base || range.count !== table.range.count) {
      for (const port of table.setRange(range)) sockets.get(port)?.close(1000, 'port range changed');
    }
    // Sockets the browser will not end by itself, dropped so their port is probed again below.
    const now = Date.now();
    for (const port of table.stalled(now)) dropSocket.get(port)?.(1006, 'no welcome');
    const quiet = table.probeSilence(now);
    for (const port of quiet.ping) ask(port, now);
    for (const port of quiet.drop) dropSocket.get(port)?.(1006, 'no sign of life');
    for (const port of table.due(now)) if (!sockets.has(port)) probe(port);
    table.roundDone();
    changed();
  } catch {
    // The next round tries again.
  } finally {
    probing = false;
    if (paired) schedule(table.nextRoundInMs());
  }
}

/**
 * The person's "Disconnect" in the popup: close that session's socket and ignore its bridge
 * until it restarts (a new instance on the port is welcome again).
 *
 * The close carries `CLOSE.personDisconnected` and not the plain 1000, because the bridge has to
 * tell this from a browser that went away (issue #28): an agent that reads it as a dropped socket
 * retries, and retrying past a dismissal is exactly what ADR 0005 exists to prevent.
 */
export function disconnectSession(port: number): boolean {
  if (!table.dismiss(port)) return false;
  sockets.get(port)?.close(CLOSE.personDisconnected, DISMISSED_REASON);
  return true;
}

export function install(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.token || changes.port || changes.portCount) void connect();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void connect();
  });
  // 30 s is the shortest period Chromium allows (≥ 120); a sleeping MV3 worker finds a new
  // session within that. An awake one probes every few seconds on its own timer.
  void browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
}
