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
 *   bridge → extension   session        { label } — the session's name changed (the MCP client
 *                                        introduced itself after the extension connected)
 *   bridge → extension   desktop        { desktop } — the desktop's accent colour changed (desktop.ts)
 *
 * Only methods named in `REQUIRED_LEVEL` (policy.ts) exist. There is deliberately no "evaluate
 * this JavaScript" method: it would make the per-origin levels meaningless.
 *
 * Every agent session runs its own bridge on its own port from a small range (ports.ts), and the
 * extension keeps one socket per bridge (ADR 0007). A bridge never talks to another bridge.
 */

import { parseDesktop, type DesktopInfo } from './desktop.ts';
import type { Feature } from './features.ts';
import type { ElementQuery, MetaQuery } from './find.ts';
import type { Level, Method } from './policy.ts';
import type { ClosedSummary, GroupColor, SessionSummary } from './sessions.ts';

export const PROTOCOL_VERSION = 1;

export const CLOSE = {
  /**
   * The person disconnected this bridge instance in the popup (`Hello.dismissed`). The bridge
   * refuses before it registers the connection, so no call of that session can reach the browser.
   */
  dismissed: 4403,
  /** Token missing or wrong. The extension shows "not paired" and stops retrying. */
  unauthorized: 4401,
  /** Protocol version mismatch. The extension shows which side is too old. */
  protocol: 4400,
  /** The bridge is shutting down. The extension retries later. */
  shutdown: 4000,
} as const;

export type BrowserFamily = 'firefox' | 'chromium' | 'epiphany' | 'safari' | 'unknown';

export interface Hello {
  type: 'hello';
  protocol: number;
  token: string;
  browser: { family: BrowserFamily; name: string; version: string };
  extension: { version: string; manifestVersion: 2 | 3 };
  /** Methods this browser can actually serve — e.g. no `page.screenshot` on Epiphany. */
  capabilities: Method[];
  /**
   * The `AgentSession.instance` the person disconnected on this port, if any. A bridge that IS
   * that instance closes with `CLOSE.dismissed` instead of welcoming; any other bridge ignores it.
   */
  dismissed?: string;
}

export interface Welcome {
  type: 'welcome';
  protocol: number;
  bridge: { version: string };
  /** The connection's id, as the agent will see it in `browsers_list`. */
  connectionId: string;
  /** Which agent session this bridge serves. Absent from bridges older than ADR 0007. */
  session?: AgentSession;
  /** The person's desktop, as far as the bridge can read it. Optional: older bridges omit it. */
  desktop?: DesktopInfo;
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

/** One element `page.find` / `page.wait` found: a ref for fill/click and the outline line for it. */
export interface FoundElement {
  ref: string;
  description: string;
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
  'page.find': {
    /**
     * Elements by role + accessible name (+ text), from the same element model and ref registry
     * as `page.outline`. With `meta`, a `<meta>` check instead: answers a count only.
     */
    params: { tabId: number; maxResults?: number; meta?: MetaQuery } & ElementQuery;
    result: { url: string; matches: FoundElement[]; count: number; truncated: boolean };
  };
  'page.wait': {
    /** Until the document has loaded, or until an element matching the query is there. */
    params: { tabId: number; for: 'load' | ElementQuery; timeoutMs?: number };
    result: { waitedMs: number; match?: FoundElement };
  };
  'page.screenshot': { params: { tabId: number }; result: { dataUrl: string } };
  /**
   * A document the page links to. `ref` is a link from `page.outline`; `url` must be on the tab's
   * own origin. The bytes come back base64 over the bridge — nothing is written to disk in the
   * browser, so the person's download folder stays theirs.
   */
  'page.download': {
    params: { tabId: number; ref?: string; url?: string; maxBytes?: number };
    result: { url: string; filename: string; mime: string; size: number; base64: string };
  };
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
  | 'failed'
  /** The person paused beifahrer in the browser. Every method answers this until they resume. */
  | 'paused'
  /** The person switched off the feature this method belongs to. `feature` names it. */
  | 'feature_disabled';

export interface WireError {
  code: ErrorCode;
  message: string;
  origin?: string | null;
  have?: Level;
  need?: Level;
  feature?: Feature | null;
}

export type Response =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: WireError };

export type ExtensionFrame = Hello | Response | { type: 'ping' };
export type BridgeFrame =
  | Welcome
  | Request
  | { type: 'pong' }
  | { type: 'session'; label: string }
  | { type: 'desktop'; desktop: DesktopInfo };

const FAMILIES: BrowserFamily[] = ['firefox', 'chromium', 'epiphany', 'safari', 'unknown'];

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
  if (h.dismissed !== undefined && typeof h.dismissed !== 'string') return 'bad dismissed';
  return h as Hello;
}

// --- agent sessions (ADR 0007) ---------------------------------------------------------------

/**
 * Which agent session a bridge serves, as the person sees it in the popup. Every agent session
 * runs its own bridge on its own port, so this identifies the bridge too.
 */
export interface AgentSession {
  /** "claude-code · werkstatt": the MCP client's name and the working directory's basename. */
  label: string;
  pid: number;
  /**
   * Random per bridge process. A person who disconnects a session dismisses THIS instance: a new
   * bridge on the same port has another one and is welcome again.
   */
  instance: string;
  /** ISO 8601. */
  startedAt: string;
}

/** A connected browser as the agent sees it. The extension's token never leaves the bridge. */
export interface ConnectedBrowser {
  id: string;
  browser: Hello['browser'];
  extension: Hello['extension'];
  capabilities: Method[];
  /** ISO 8601. */
  connectedAt: string;
}

/** What one bridge reports about itself and its browsers: what `browsers_list` is built from. */
export interface BridgeStatus {
  port: number;
  version: string;
  session: AgentSession;
  browsers: ConnectedBrowser[];
}

export const SESSION_LABEL_MAX = 80;

/** C0/C1 controls, DEL and the bidi marks and overrides: one session could pose as another. */
function isUnsafe(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/**
 * A label fit to show in the browser: printable, one line, capped. The bridge is the agent's side,
 * so the extension treats its label as untrusted text (and renders it as text, never markup).
 * Null when nothing printable is left.
 */
export function cleanSessionLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const flat = Array.from(raw, (ch) => (isUnsafe(ch.codePointAt(0)!) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > SESSION_LABEL_MAX ? `${flat.slice(0, SESSION_LABEL_MAX - 1)}…` : flat;
}

/**
 * The default label: who is asking (the MCP client's name, or the command) and where (the
 * basename of the working directory), e.g. "claude-code · werkstatt".
 */
export function defaultSessionLabel(client: string, cwd: string): string {
  const dir =
    cwd
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ||
    cwd ||
    '/';
  return cleanSessionLabel(`${client} · ${dir}`) ?? 'beifahrer';
}

function parseAgentSession(raw: unknown): AgentSession | null {
  const s = raw as Partial<AgentSession> | null;
  if (!s || typeof s !== 'object') return null;
  const label = cleanSessionLabel(s.label);
  if (!label || typeof s.pid !== 'number' || typeof s.instance !== 'string' || !s.instance) return null;
  if (typeof s.startedAt !== 'string') return null;
  return { label, pid: s.pid, instance: s.instance.slice(0, 64), startedAt: s.startedAt };
}

/**
 * Validate a welcome (extension side). A bridge from before ADR 0007 sends no `session`; it is
 * accepted, and the extension shows it as an unnamed session.
 */
export function parseWelcome(raw: unknown): Welcome | null {
  const w = raw as Partial<Welcome> | null;
  if (!w || w.type !== 'welcome' || typeof w.connectionId !== 'string') return null;
  if (!w.bridge || typeof w.bridge.version !== 'string') return null;
  const session = w.session === undefined ? undefined : parseAgentSession(w.session);
  if (session === null) return null;
  // Cosmetic: a desktop the extension cannot read is dropped, never a reason to refuse the bridge.
  const desktop = parseDesktop(w.desktop);
  return {
    type: 'welcome',
    protocol: typeof w.protocol === 'number' ? w.protocol : PROTOCOL_VERSION,
    bridge: { version: w.bridge.version },
    connectionId: w.connectionId,
    ...(session ? { session } : {}),
    ...(desktop.accent ? { desktop } : {}),
  };
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
