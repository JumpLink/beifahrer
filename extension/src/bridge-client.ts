/**
 * The extension's side of the loopback socket: connect to the bridge, say hello with the pairing
 * token, then serve requests until the socket closes — and come back when the bridge does.
 *
 * Two lifetimes to survive:
 * - MV2 (Firefox, Epiphany): a persistent background page. Retrying with a timer is enough.
 * - MV3 (Chromium): a service worker that the browser suspends after ~30 s without events. An
 *   open WebSocket that sees traffic keeps it alive (Chrome ≥ 116), hence the ping every 20 s.
 *   When the bridge is down there is no traffic, the worker sleeps, and timers die with it — so a
 *   one-minute alarm wakes it to try again.
 */

import { browser } from 'wxt/browser';
import {
  CLOSE,
  PROTOCOL_VERSION,
  isMethod,
  type BridgeFrame,
  type Hello,
  type Response,
} from '@beifahrer/core';
import { browserInfo, manifestVersion } from './browser-info.ts';
import { MethodError, capabilities, runMethod } from './handlers.ts';
import { loadSettings } from './settings.ts';

export type Status =
  | { state: 'unpaired' }
  | { state: 'connecting'; port: number }
  | { state: 'connected'; port: number; connectionId: string; bridgeVersion: string }
  | { state: 'offline'; port: number; retryInMs: number }
  | { state: 'unauthorized'; port: number }
  | { state: 'protocol'; port: number; reason: string };

export const RECONNECT_ALARM = 'beifahrer-reconnect';
const PING_MS = 20_000;

let socket: WebSocket | null = null;
let status: Status = { state: 'unpaired' };
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let backoff = 1_000;

export const currentStatus = (): Status => status;

function send(frame: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

async function serve(id: number, method: unknown, params: unknown): Promise<void> {
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
      response = { type: 'response', id, ok: true, result: await runMethod(method, params) };
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
  send(response);
}

function scheduleRetry(port: number): void {
  clearTimeout(retryTimer);
  const wait = backoff;
  backoff = Math.min(backoff * 2, 30_000);
  status = { state: 'offline', port, retryInMs: wait };
  retryTimer = setTimeout(() => void connect(), wait);
}

export async function connect(): Promise<void> {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(retryTimer);
  const { token, port } = await loadSettings();
  if (!token) {
    status = { state: 'unpaired' };
    return;
  }
  status = { state: 'connecting', port };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  socket = ws;

  ws.onopen = async () => {
    const hello: Hello = {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      browser: await browserInfo(),
      extension: { version: browser.runtime.getManifest().version, manifestVersion: manifestVersion() },
      capabilities: capabilities(),
    };
    send(hello);
  };

  ws.onmessage = (event) => {
    let frame: BridgeFrame;
    try {
      frame = JSON.parse(String(event.data)) as BridgeFrame;
    } catch {
      return; // not JSON — not the bridge speaking; ignore rather than crash the worker
    }
    if (frame.type === 'welcome') {
      backoff = 1_000;
      status = {
        state: 'connected',
        port,
        connectionId: frame.connectionId,
        bridgeVersion: frame.bridge.version,
      };
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
    } else if (frame.type === 'request') {
      void serve(frame.id, frame.method, frame.params);
    }
  };

  ws.onclose = (event) => {
    clearInterval(pingTimer);
    if (socket === ws) socket = null;
    if (event.code === CLOSE.unauthorized) {
      // Retrying with the same token cannot succeed; wait for the person to paste a new one.
      status = { state: 'unauthorized', port };
      return;
    }
    if (event.code === CLOSE.protocol) {
      status = { state: 'protocol', port, reason: event.reason };
      return;
    }
    scheduleRetry(port);
  };
}

export function disconnect(): void {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  socket?.close(1000, 'settings changed');
  socket = null;
}

export function install(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.token || changes.port) {
      backoff = 1_000;
      disconnect();
      void connect();
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void connect();
  });
  void browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
}
