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
 */

import { browser } from '@wxt-dev/browser';
import {
  CLOSE,
  ConnectionTable,
  DEFAULT_PORT_RANGE,
  PROTOCOL_VERSION,
  cleanSessionLabel,
  isMethod,
  parseWelcome,
  type BridgeFrame,
  type Hello,
  type Overall,
  type PortRange,
  type Response,
  type SessionView,
} from '@beifahrer/core';
import { rememberDesktop } from './accent.ts';
import { browserInfo, manifestVersion } from './browser-info.ts';
import { MethodError, capabilities, runMethod } from './handlers.ts';
import { loadSettings } from './settings.ts';

export type Status =
  | { state: 'unpaired' }
  | { state: Overall; range: PortRange; sessions: SessionView[]; detail?: string };

export const RECONNECT_ALARM = 'beifahrer-reconnect';
const PING_MS = 20_000;

const table = new ConnectionTable(DEFAULT_PORT_RANGE);
const sockets = new Map<number, WebSocket>();
const pings = new Map<number, ReturnType<typeof setInterval>>();
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
      const result = await runMethod(method, params, { session: table.labelOf(port) });
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
  send(ws, response);
}

function probe(port: number): void {
  table.connecting(port);
  let opened = false;
  // Loopback only, by construction: the host is a literal, the port a number from the range.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  sockets.set(port, ws);

  ws.onopen = async () => {
    opened = true;
    const dismissed = table.dismissedInstance(port);
    const hello: Hello = {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      browser: await browserInfo(),
      extension: { version: browser.runtime.getManifest().version, manifestVersion: manifestVersion() },
      capabilities: capabilities(),
      ...(dismissed ? { dismissed } : {}),
    };
    send(ws, hello);
  };

  ws.onmessage = (event) => {
    let frame: BridgeFrame;
    try {
      frame = JSON.parse(String(event.data)) as BridgeFrame;
    } catch {
      return; // not JSON — not a bridge speaking; ignore rather than crash the worker
    }
    if (frame.type === 'welcome') {
      const welcome = parseWelcome(frame);
      if (!welcome || !table.welcomed(port, welcome, Date.now())) {
        ws.close(1000, 'the person disconnected this session');
        return;
      }
      clearInterval(pings.get(port));
      pings.set(
        port,
        setInterval(() => send(ws, { type: 'ping' }), PING_MS),
      );
      if (welcome.desktop) void rememberDesktop(welcome.desktop);
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

  ws.onclose = (event) => {
    clearInterval(pings.get(port));
    pings.delete(port);
    if (sockets.get(port) !== ws) return;
    sockets.delete(port);
    table.closed(port, { opened, code: event.code, reason: event.reason }, Date.now());
    changed();
    // A session that went away may come back at once (a restart): look again soon.
    if (opened && event.code !== CLOSE.dismissed) schedule(table.nextRoundInMs());
  };
}

function closeAll(reason: string): void {
  for (const ws of sockets.values()) ws.close(1000, reason);
}

function schedule(ms: number): void {
  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => void connect(), ms);
}

/** One probe round over the range, then the next one is scheduled. Safe to call any time. */
export async function connect(): Promise<void> {
  if (probing) return;
  probing = true;
  try {
    clearTimeout(roundTimer);
    const settings = await loadSettings();
    if (settings.token !== token) {
      // Another token: every open socket was admitted with the old one.
      token = settings.token;
      table.resetRefusals();
      closeAll('pairing changed');
    }
    if (!token) {
      changed();
      return; // storage.onChanged starts probing once the person pastes a token
    }
    const range = { base: settings.port, count: settings.portCount };
    if (range.base !== table.range.base || range.count !== table.range.count) {
      for (const port of table.setRange(range)) sockets.get(port)?.close(1000, 'port range changed');
    }
    for (const port of table.due(Date.now())) if (!sockets.has(port)) probe(port);
    table.roundDone();
    schedule(table.nextRoundInMs());
    changed();
  } finally {
    probing = false;
  }
}

/**
 * The person's "Disconnect" in the popup: close that session's socket and ignore its bridge
 * until it restarts (a new instance on the port is welcome again).
 */
export function disconnectSession(port: number): boolean {
  if (!table.dismiss(port)) return false;
  sockets.get(port)?.close(1000, 'the person disconnected this session');
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
