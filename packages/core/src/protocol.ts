/**
 * The wire protocol between the bridge (MCP server, listens on 127.0.0.1) and the extension
 * (connects out). JSON text frames over one WebSocket.
 *
 *   extension → bridge   hello          first frame, carries the pairing token
 *   bridge → extension   welcome        or a close with one of the CLOSE codes below
 *   bridge → extension   request        { id, method, params }
 *   extension → bridge   response       { id, ok, result | error }
 *   extension → bridge   ping           keep-alive; a Chromium MV3 service worker sleeps without it
 *   bridge → extension   pong
 *
 * Only methods named in `REQUIRED_LEVEL` (policy.ts) exist. There is deliberately no "evaluate
 * this JavaScript" method: it would make the per-origin levels meaningless.
 */

import type { Level, Method } from './policy.ts';

export const PROTOCOL_VERSION = 1;

/** Default loopback port. Both sides let the person override it. */
export const DEFAULT_PORT = 47813;

export const CLOSE = {
  /** Token missing or wrong. The extension shows "not paired" and stops retrying. */
  unauthorized: 4401,
  /** Protocol version mismatch. The extension shows which side is too old. */
  protocol: 4400,
  /** The bridge is shutting down. The extension retries later. */
  shutdown: 4000,
} as const;

export type BrowserFamily = 'firefox' | 'chromium' | 'epiphany' | 'unknown';

export interface Hello {
  type: 'hello';
  protocol: number;
  token: string;
  browser: { family: BrowserFamily; name: string; version: string };
  extension: { version: string; manifestVersion: 2 | 3 };
  /** Methods this browser can actually serve — e.g. no `page.screenshot` on Epiphany. */
  capabilities: Method[];
}

export interface Welcome {
  type: 'welcome';
  protocol: number;
  bridge: { version: string };
  /** The connection's id, as the agent will see it in `browsers_list`. */
  connectionId: string;
}

export interface TabInfo {
  tabId: number;
  windowId: number;
  /** Active tab of its window. */
  active: boolean;
  /** Its window is the one the person focused last — together with `active`: what they see. */
  focusedWindow: boolean;
  /** Host only, even when everything else is redacted. Null for non-web pages. */
  host: string | null;
  level: Level;
  /** Present only when the origin's level is at least `read`. */
  url?: string;
  title?: string;
}

export interface MethodMap {
  'tabs.list': { params: Record<string, never>; result: { tabs: TabInfo[] } };
  'tabs.active': { params: Record<string, never>; result: { tab: TabInfo | null } };
  'page.read': {
    params: { tabId: number; maxChars?: number };
    result: { url: string; title: string; text: string; truncated: boolean };
  };
  'page.outline': {
    params: { tabId: number; maxItems?: number };
    result: { url: string; title: string; outline: string; count: number; truncated: boolean };
  };
  'page.screenshot': { params: { tabId: number }; result: { dataUrl: string } };
  'page.fill': {
    params: { tabId: number; ref: string; text: string; as?: 'text' | 'html'; mode?: 'replace' | 'append' };
    result: { ref: string; value: string };
  };
  'page.click': { params: { tabId: number; ref: string }; result: { ref: string } };
  'tabs.open': { params: { url: string; active?: boolean }; result: { tab: TabInfo } };
}

export type Params<M extends Method> = MethodMap[M]['params'];
export type Result<M extends Method> = MethodMap[M]['result'];

export interface Request<M extends Method = Method> {
  type: 'request';
  id: number;
  method: M;
  params: Params<M>;
}

export type ErrorCode =
  /** The policy does not allow it. Carries origin + levels so the agent can ask the person. */
  | 'forbidden'
  /** The person declined in the confirmation window, or let it time out. */
  | 'denied'
  | 'not_found'
  /** This browser cannot do it (see `Hello.capabilities`). */
  | 'unsupported'
  | 'invalid'
  | 'timeout'
  | 'failed';

export interface WireError {
  code: ErrorCode;
  message: string;
  origin?: string | null;
  have?: Level;
  need?: Level;
}

export type Response =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: WireError };

export type ExtensionFrame = Hello | Response | { type: 'ping' };
export type BridgeFrame = Welcome | Request | { type: 'pong' };

const FAMILIES: BrowserFamily[] = ['firefox', 'chromium', 'epiphany', 'unknown'];

/** Validate a hello frame. Returns a reason string on failure — used in the close frame. */
export function parseHello(raw: unknown): Hello | string {
  const h = raw as Partial<Hello> | null;
  if (!h || h.type !== 'hello') return 'first frame must be hello';
  if (h.protocol !== PROTOCOL_VERSION) return `protocol ${String(h.protocol)} ≠ ${PROTOCOL_VERSION}`;
  if (typeof h.token !== 'string' || h.token.length === 0) return 'missing token';
  const b = h.browser;
  if (!b || !FAMILIES.includes(b.family as BrowserFamily) || typeof b.name !== 'string') return 'bad browser';
  const e = h.extension;
  if (!e || (e.manifestVersion !== 2 && e.manifestVersion !== 3)) return 'bad extension';
  if (!Array.isArray(h.capabilities)) return 'bad capabilities';
  return h as Hello;
}

/** Validate a response frame from the extension. */
export function parseResponse(raw: unknown): Response | null {
  const r = raw as Partial<Response> | null;
  if (!r || r.type !== 'response' || typeof r.id !== 'number') return null;
  if (r.ok === true) return r as Response;
  if (r.ok === false) {
    const err = (r as { error?: Partial<WireError> }).error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') return r as Response;
  }
  return null;
}

/**
 * Constant-time comparison of the pairing token. The bridge only listens on loopback, but a
 * comparison that returns early leaks the matching prefix length to any local process that can
 * time it, and doing it right costs nothing.
 */
export function tokensEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Origins a browser puts on a WebSocket handshake started by an extension. A web page cannot
 * send any of these — so a page that opens ws://127.0.0.1 is refused before the token is even
 * looked at.
 */
export function isExtensionOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return /^(moz-extension|chrome-extension|ephy-webextension|safari-web-extension):\/\/[A-Za-z0-9-]+$/.test(
    origin,
  );
}
