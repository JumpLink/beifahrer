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
 *
 * The same socket also admits AGENT PEERS: other `beifahrer mcp` processes on this machine that
 * found the port taken and relay their calls through the process that owns it, the hub
 * (ADR 0003). A peer sends no Origin (it is not a browser) and says `agent-hello`:
 *
 *   peer → hub   agent-hello     first frame, carries the same pairing token
 *   hub → peer   agent-welcome   or a close with one of the CLOSE codes
 *   peer → hub   agent-call      { id, method, params, browser? } — one call, routed like the hub's own
 *   peer → hub   agent-status    { id } — which browsers are connected, how many peers
 *   hub → peer   agent-reply     { id, ok, result | error } — the hub's answer, unchanged
 */

import { isMethod, type Level, type Method } from './policy.ts';
import type { ClosedSummary, GroupColor, SessionSummary } from './sessions.ts';

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
  /** Position in its window, from 0 — what `tabs.move` takes. */
  index?: number;
  pinned?: boolean;
  /** Tab group, where the browser has them; absent when the tab is in none. */
  groupId?: number;
}

/** Tabs to act on: explicit ids, or every tab of one window. */
export interface TabSelection {
  tabIds?: number[];
  windowId?: number;
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
  'tabs.move': {
    /** `index` -1 = end of the window. Several tabs keep their given order from `index` on. */
    params: { tabIds: number[]; index: number; windowId?: number };
    result: { tabs: TabInfo[] };
  };
  'tabs.pin': { params: { tabIds: number[]; pinned: boolean }; result: { tabs: TabInfo[] } };
  'tabs.close': { params: TabSelection; result: { closed: number } };
  'tabs.group': {
    params: { tabIds: number[]; groupId?: number; title?: string; color?: GroupColor; collapsed?: boolean };
    result: { groupId: number };
  };
  'tabs.ungroup': { params: { tabIds: number[] }; result: { tabs: TabInfo[] } };
  'windows.create': {
    /** New tabs from `tabs` (each URL needs `read`), existing tabs moved over by `tabIds`, or both. */
    params: { tabs?: { url: string; pinned?: boolean }[]; tabIds?: number[] };
    result: { windowId: number; tabs: TabInfo[] };
  };
  'sessions.save': {
    params: { name: string; windows?: 'all' | number[] };
    result: { session: SessionSummary; skipped: number };
  };
  'sessions.list': { params: { name?: string }; result: { sessions: SessionSummary[] } };
  'sessions.restore': {
    params: { name: string; into?: 'new-windows' | 'current' };
    result: { windowIds: number[]; opened: number; skipped: number };
  };
  'sessions.delete': { params: { name: string }; result: { deleted: boolean } };
  'sessions.define': {
    params: { name: string; windows: { tabs: { url: string; pinned?: boolean }[] }[] };
    result: { session: SessionSummary };
  };
  'sessions.recentlyClosed': { params: { maxResults?: number }; result: { closed: ClosedSummary[] } };
  'sessions.restoreClosed': { params: { sessionId: string }; result: { windowId?: number; tabs: TabInfo[] } };
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

// --- agent peers (ADR 0003) ------------------------------------------------------------------

export interface AgentHello {
  type: 'agent-hello';
  protocol: number;
  token: string;
  agent: { version: string; pid: number };
}

export interface AgentWelcome {
  type: 'agent-welcome';
  protocol: number;
  bridge: { version: string; pid: number };
  peerId: string;
}

export interface AgentCall<M extends Method = Method> {
  type: 'agent-call';
  id: number;
  method: M;
  params: Params<M>;
  browser?: string;
}

export interface AgentStatusRequest {
  type: 'agent-status';
  id: number;
}

export type AgentRequest = AgentCall | AgentStatusRequest;

export type AgentReply =
  | { type: 'agent-reply'; id: number; ok: true; result: unknown }
  | { type: 'agent-reply'; id: number; ok: false; error: WireError };

/** A connected browser as the agent sees it. The extension's token never leaves the hub. */
export interface ConnectedBrowser {
  id: string;
  browser: Hello['browser'];
  extension: Hello['extension'];
  capabilities: Method[];
  /** ISO 8601. */
  connectedAt: string;
}

/** The answer to `agent-status`, and what `browsers_list` is built from. */
export interface HubStatus {
  port: number;
  hub: { pid: number; version: string; peers: number };
  browsers: ConnectedBrowser[];
}

/**
 * Classify the first frame on a new connection. Which role it may take is NOT decided here: the
 * hub checks the role against the handshake's Origin (`roleAllowed`).
 */
export function parseFirstFrame(
  raw: unknown,
): { role: 'extension'; hello: Hello } | { role: 'agent'; hello: AgentHello } | string {
  if ((raw as { type?: unknown } | null)?.type === 'agent-hello') {
    const hello = parseAgentHello(raw);
    return typeof hello === 'string' ? hello : { role: 'agent', hello };
  }
  const hello = parseHello(raw);
  return typeof hello === 'string' ? hello : { role: 'extension', hello };
}

export function parseAgentHello(raw: unknown): AgentHello | string {
  const h = raw as Partial<AgentHello> | null;
  if (!h || h.type !== 'agent-hello') return 'first frame must be agent-hello';
  if (h.protocol !== PROTOCOL_VERSION) return `protocol ${String(h.protocol)} ≠ ${PROTOCOL_VERSION}`;
  if (typeof h.token !== 'string' || h.token.length === 0) return 'missing token';
  const a = h.agent;
  if (!a || typeof a.version !== 'string' || typeof a.pid !== 'number') return 'bad agent';
  return h as AgentHello;
}

export function parseAgentWelcome(raw: unknown): AgentWelcome | null {
  const w = raw as Partial<AgentWelcome> | null;
  if (!w || w.type !== 'agent-welcome' || w.protocol !== PROTOCOL_VERSION) return null;
  if (typeof w.peerId !== 'string' || !w.bridge || typeof w.bridge.pid !== 'number') return null;
  return w as AgentWelcome;
}

/**
 * Validate a peer's request. Fail closed like everything else: a method that is not in
 * `REQUIRED_LEVEL` is not relayed, whatever the peer claims.
 */
export function parseAgentRequest(raw: unknown): AgentRequest | null {
  const r = raw as (Omit<Partial<AgentCall>, 'type'> & { type?: string }) | null;
  if (!r || typeof r.id !== 'number' || !Number.isInteger(r.id)) return null;
  if (r.type === 'agent-status') return { type: 'agent-status', id: r.id };
  if (r.type !== 'agent-call' || !isMethod(r.method)) return null;
  if (!r.params || typeof r.params !== 'object' || Array.isArray(r.params)) return null;
  if (r.browser !== undefined && typeof r.browser !== 'string') return null;
  return { type: 'agent-call', id: r.id, method: r.method, params: r.params, browser: r.browser };
}

export function parseAgentReply(raw: unknown): AgentReply | null {
  const r = raw as Partial<AgentReply> | null;
  if (!r || r.type !== 'agent-reply' || typeof r.id !== 'number') return null;
  if (r.ok === true) return r as AgentReply;
  if (r.ok === false) {
    const err = (r as { error?: Partial<WireError> }).error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') return r as AgentReply;
  }
  return null;
}

/**
 * Which origin a handshake carried, reduced to what admission needs:
 * - `extension`: an extension origin — may only become an extension connection;
 * - `none`: no Origin header at all — a local process, may only become an agent peer;
 * - `page`: anything else, above all a web page. Refused in the handshake already.
 *
 * Browsers always send an Origin on a WebSocket handshake, so a web page can never arrive as
 * `none`, and therefore never as an agent.
 */
export type OriginKind = 'extension' | 'none' | 'page';

export function originKind(origin: string | undefined | null): OriginKind {
  if (origin === undefined || origin === null || origin === '') return 'none';
  return isExtensionOrigin(origin) ? 'extension' : 'page';
}

/** The one rule tying the first frame to the handshake. Everything not listed is refused. */
export function roleAllowed(kind: OriginKind, role: 'extension' | 'agent'): boolean {
  return (kind === 'extension' && role === 'extension') || (kind === 'none' && role === 'agent');
}

/** The bridge listens on 127.0.0.1 only; this re-checks the peer address anyway. */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address) || address === '::1';
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
