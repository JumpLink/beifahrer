/**
 * Saved sessions ("workspaces"): the person's windows and tabs, kept in the EXTENSION's storage so
 * a window closed by mistake can come back, and so an agent can lay out the tabs for a task.
 *
 * Where they live and why: ADR 0004. The model is pure so that everything that decides what is
 * stored, what an agent may see of it and what a restore opens is testable without a browser:
 *
 * - Parsing is fail-closed like `parsePolicy`: a malformed session, window or tab is dropped one
 *   by one, never repaired into something wider.
 * - An agent sees a saved tab the way `tabs.list` shows an open one: host only below `read`.
 * - Restoring the person's OWN saved tabs opens them all, below-read ones included — they were
 *   the person's tabs and the agent never learns their URLs. A session the AGENT defined is
 *   rechecked at restore time, because its URLs came from the agent.
 */

import { decide, levelFor, originOf, type Level, type Policy } from './policy.ts';
import { hostOf } from './redact.ts';

export const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface SavedGroup {
  title: string;
  color?: GroupColor;
  collapsed?: boolean;
}

export interface SavedTab {
  url: string;
  /** Kept so a lazily restored tab has a label before it loads (Firefox shows it). */
  title?: string;
  pinned: boolean;
  /** Index into the window's `groups`. */
  group?: number;
}

export interface SavedWindow {
  tabs: SavedTab[];
  groups: SavedGroup[];
}

/**
 * - `saved`: the person's windows as they were (saved by the person, or by the agent on request).
 * - `auto`: an automatic snapshot, rotated.
 * - `agent`: built by the agent from URLs it chose (`sessions.define`).
 */
export type SessionKind = 'saved' | 'auto' | 'agent';

export interface SavedSession {
  name: string;
  kind: SessionKind;
  /** Milliseconds since the epoch. */
  savedAt: number;
  windows: SavedWindow[];
}

export const AUTOSAVE_PREFIX = 'autosave-';
/** Automatic snapshots kept; older ones are dropped. */
export const AUTOSAVE_KEEP = 20;
export const MAX_NAME = 100;
export const MAX_WINDOWS = 50;
export const MAX_TABS = 500;
const MAX_TITLE = 300;

/**
 * Only http(s) tabs are saved. `about:`, `chrome://`, `file://` and extension pages cannot be
 * opened by an extension anyway, and a local file path is nothing to keep in a session list.
 */
export function isRestorableUrl(url: string | undefined | null): url is string {
  return originOf(url) !== null;
}

export type SessionNameIssue = 'type' | 'empty' | 'whitespace' | 'length' | 'control' | 'reserved';

/**
 * Why `name` cannot name a session, as a code: the options page words it in the person's
 * language, `sessionNameError` in English for the agent. One rule set for both.
 */
export function sessionNameIssue(name: unknown, { allowAutosave = false } = {}): SessionNameIssue | null {
  if (typeof name !== 'string') return 'type';
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed !== name) return 'whitespace';
  if (name.length > MAX_NAME) return 'length';
  // oxlint-disable-next-line no-control-regex -- the point is to refuse control characters
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'control';
  if (!allowAutosave && name.startsWith(AUTOSAVE_PREFIX)) return 'reserved';
  return null;
}

const NAME_ERRORS: Record<SessionNameIssue, string> = {
  type: 'name must be a string',
  empty: 'name must not be empty',
  whitespace: 'name must not start or end with whitespace',
  length: `name is longer than ${MAX_NAME} characters`,
  control: 'name must not contain control characters',
  reserved: `names starting with "${AUTOSAVE_PREFIX}" are the automatic snapshots — pick another`,
};

/** Why `name` cannot name a session the person or agent saves, or null when it can. */
export function sessionNameError(name: unknown, options: { allowAutosave?: boolean } = {}): string | null {
  const issue = sessionNameIssue(name, options);
  return issue ? NAME_ERRORS[issue] : null;
}

// --- snapshot: browser windows → a session --------------------------------------------------

export interface RawSessionTab {
  url?: string;
  /** Chromium: the URL a tab is still navigating to; `url` is empty until it commits. */
  pendingUrl?: string;
  title?: string;
  pinned?: boolean;
  index?: number;
  groupId?: number;
}

export interface RawWindow {
  id?: number;
  type?: string;
  incognito?: boolean;
  tabs?: RawSessionTab[];
}

export interface RawGroup {
  id: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
}

function groupFrom(raw: RawGroup | undefined): SavedGroup {
  const group: SavedGroup = { title: typeof raw?.title === 'string' ? raw.title.slice(0, MAX_TITLE) : '' };
  if (GROUP_COLORS.includes(raw?.color as GroupColor)) group.color = raw!.color as GroupColor;
  if (raw?.collapsed === true) group.collapsed = true;
  return group;
}

/**
 * The person's windows as a session. Private (incognito) windows and non-normal windows (popups,
 * the confirmation window) are never saved; tabs that cannot be reopened are counted in `skipped`.
 */
export function snapshot(
  windows: RawWindow[],
  groups: RawGroup[],
  meta: { name: string; kind: SessionKind; now: number },
): { session: SavedSession; skipped: number } {
  const groupInfo = new Map(groups.map((g) => [g.id, g]));
  let skipped = 0;
  const saved: SavedWindow[] = [];
  for (const win of windows) {
    if (win.incognito === true) continue;
    if (win.type !== undefined && win.type !== 'normal') continue;
    const tabs = [...(win.tabs ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const out: SavedWindow = { tabs: [], groups: [] };
    const groupIndex = new Map<number, number>();
    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl;
      if (!isRestorableUrl(url) || out.tabs.length >= MAX_TABS) {
        skipped++;
        continue;
      }
      const entry: SavedTab = { url, pinned: tab.pinned === true };
      if (typeof tab.title === 'string' && tab.title) entry.title = tab.title.slice(0, MAX_TITLE);
      if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
        let index = groupIndex.get(tab.groupId);
        if (index === undefined) {
          index = out.groups.length;
          out.groups.push(groupFrom(groupInfo.get(tab.groupId)));
          groupIndex.set(tab.groupId, index);
        }
        entry.group = index;
      }
      out.tabs.push(entry);
    }
    if (out.tabs.length > 0 && saved.length < MAX_WINDOWS) saved.push(out);
  }
  return { session: { name: meta.name, kind: meta.kind, savedAt: meta.now, windows: saved }, skipped };
}

// --- parsing: storage → sessions, fail closed -----------------------------------------------

function parseTab(raw: unknown, groupCount: number): SavedTab | null {
  const t = raw as Partial<SavedTab> | null;
  if (!t || typeof t !== 'object' || !isRestorableUrl(t.url)) return null;
  const tab: SavedTab = { url: t.url, pinned: t.pinned === true };
  if (typeof t.title === 'string' && t.title) tab.title = t.title.slice(0, MAX_TITLE);
  if (typeof t.group === 'number' && Number.isInteger(t.group) && t.group >= 0 && t.group < groupCount)
    tab.group = t.group;
  return tab;
}

function parseWindow(raw: unknown): SavedWindow | null {
  const w = raw as { tabs?: unknown; groups?: unknown } | null;
  if (!w || typeof w !== 'object' || !Array.isArray(w.tabs)) return null;
  const groups = Array.isArray(w.groups)
    ? w.groups.map((g) => groupFrom(g && typeof g === 'object' ? (g as RawGroup) : undefined))
    : [];
  const tabs = w.tabs
    .slice(0, MAX_TABS)
    .map((t) => parseTab(t, groups.length))
    .filter((t): t is SavedTab => t !== null);
  return tabs.length ? { tabs, groups } : null;
}

export function parseSession(raw: unknown): SavedSession | null {
  const s = raw as Partial<SavedSession> | null;
  if (!s || typeof s !== 'object') return null;
  if (sessionNameError(s.name, { allowAutosave: true }) !== null) return null;
  if (s.kind !== 'saved' && s.kind !== 'auto' && s.kind !== 'agent') return null;
  if (typeof s.savedAt !== 'number' || !Number.isFinite(s.savedAt)) return null;
  if (!Array.isArray(s.windows)) return null;
  const windows = s.windows
    .slice(0, MAX_WINDOWS)
    .map(parseWindow)
    .filter((w): w is SavedWindow => w !== null);
  if (windows.length === 0) return null;
  return { name: s.name!, kind: s.kind, savedAt: s.savedAt, windows };
}

/** Sessions read back from storage. Malformed ones are dropped; a duplicate name keeps the first. */
export function parseSessions(raw: unknown): SavedSession[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedSession[] = [];
  for (const item of raw) {
    const session = parseSession(item);
    if (!session || seen.has(session.name)) continue;
    seen.add(session.name);
    out.push(session);
  }
  return out;
}

// --- the agent's own workspaces --------------------------------------------------------------

export type DefineResult =
  | { ok: true; session: SavedSession }
  | {
      ok: false;
      code: 'invalid' | 'forbidden';
      message: string;
      origin?: string | null;
      have?: Level;
      need?: Level;
    };

/**
 * A session the agent builds from URLs it chooses: `{ name, windows: [{ tabs: [{ url, pinned }] }] }`.
 * Every URL needs level `read` on its site, the same rule as opening one tab — otherwise a saved
 * workspace would be a way to open, later, a URL the person never allowed.
 */
export function defineSession(raw: unknown, policy: Policy, now: number): DefineResult {
  const d = raw as { name?: unknown; windows?: unknown } | null;
  const nameError = sessionNameError(d?.name);
  if (nameError) return { ok: false, code: 'invalid', message: nameError };
  if (!Array.isArray(d!.windows) || d!.windows.length === 0)
    return { ok: false, code: 'invalid', message: 'windows must be a non-empty array' };
  if (d!.windows.length > MAX_WINDOWS)
    return { ok: false, code: 'invalid', message: `at most ${MAX_WINDOWS} windows` };
  const windows: SavedWindow[] = [];
  for (const w of d!.windows as unknown[]) {
    const tabs = (w as { tabs?: unknown } | null)?.tabs;
    if (!Array.isArray(tabs) || tabs.length === 0)
      return { ok: false, code: 'invalid', message: 'every window needs a non-empty tabs array' };
    if (tabs.length > MAX_TABS) return { ok: false, code: 'invalid', message: `at most ${MAX_TABS} tabs` };
    const out: SavedWindow = { tabs: [], groups: [] };
    for (const t of tabs as unknown[]) {
      const url = (t as { url?: unknown } | null)?.url;
      if (typeof url !== 'string' || !isRestorableUrl(url))
        return { ok: false, code: 'invalid', message: `not an http(s) URL: ${String(url)}` };
      const decision = decide(policy, 'sessions.define', url);
      if (!decision.allow)
        return {
          ok: false,
          code: 'forbidden',
          message: `${decision.origin ?? url} is at level "${decision.have}"; a workspace may only contain sites at "read" or higher. Ask the person to allow the site first.`,
          origin: decision.origin,
          have: decision.have,
          need: decision.need,
        };
      out.tabs.push({ url, pinned: (t as { pinned?: unknown }).pinned === true });
    }
    // Browsers keep pinned tabs first; saving them in that order keeps a restore exact.
    out.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    windows.push(out);
  }
  return { ok: true, session: { name: d!.name as string, kind: 'agent', savedAt: now, windows } };
}

// --- what a restore opens ------------------------------------------------------------------

/**
 * The windows a restore opens. The person's own sessions come back whole. An agent-defined one is
 * checked again against the policy as it is NOW: the person may have lowered a site since, and
 * then its URL — the agent's choice — is not opened.
 */
export function restorePlan(
  session: SavedSession,
  policy: Policy,
): { windows: SavedWindow[]; skipped: number } {
  if (session.kind !== 'agent') return { windows: session.windows, skipped: 0 };
  let skipped = 0;
  const windows: SavedWindow[] = [];
  for (const w of session.windows) {
    const tabs = w.tabs.filter((t) => decide(policy, 'sessions.define', t.url).allow);
    skipped += w.tabs.length - tabs.length;
    if (tabs.length) windows.push({ tabs, groups: w.groups });
  }
  return { windows, skipped };
}

// --- storing ---------------------------------------------------------------------------------

/** `session` added to `sessions`, replacing one of the same name. */
export function upsertSession(sessions: SavedSession[], session: SavedSession): SavedSession[] {
  return [...sessions.filter((s) => s.name !== session.name), session];
}

function sameWindows(a: SavedWindow[], b: SavedWindow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Add an automatic snapshot and drop the oldest beyond `keep`. Returns null when nothing changed
 * since the newest snapshot — an idle browser must not rotate the one snapshot that still has
 * the window closed by mistake out of the list.
 */
export function addAutosave(
  sessions: SavedSession[],
  snap: SavedSession,
  keep = AUTOSAVE_KEEP,
): SavedSession[] | null {
  if (snap.kind !== 'auto' || snap.windows.length === 0) return null;
  const autos = sessions.filter((s) => s.kind === 'auto').sort((a, b) => a.savedAt - b.savedAt);
  const newest = autos[autos.length - 1];
  if (newest && sameWindows(newest.windows, snap.windows)) return null;
  const drop = new Set(autos.slice(0, Math.max(0, autos.length + 1 - keep)).map((s) => s.name));
  return upsertSession(
    sessions.filter((s) => !drop.has(s.name)),
    snap,
  );
}

/** `autosave-2026-09-25T10:15:30Z` — sorts by time, readable in the options page. */
export function autosaveName(now: number): string {
  return `${AUTOSAVE_PREFIX}${new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

// --- what the agent sees ---------------------------------------------------------------------

export interface TabSummary {
  host: string | null;
  level: Level;
  pinned: boolean;
  group?: number;
  /** Present only when the site's level is at least `read`. */
  url?: string;
  title?: string;
}

export interface SessionSummary {
  name: string;
  kind: SessionKind;
  savedAt: string;
  windowCount: number;
  tabCount: number;
  windows?: { tabs: TabSummary[]; groups: SavedGroup[] }[];
}

/** A saved tab the way the agent may see it — the same rule as `toTabInfo`. */
export function summarizeTab(
  tab: { url?: string; title?: string; pinned?: boolean; group?: number },
  policy: Policy,
): TabSummary {
  const level = levelFor(policy, tab.url);
  const out: TabSummary = { host: hostOf(tab.url), level, pinned: tab.pinned === true };
  if (tab.group !== undefined) out.group = tab.group;
  if (level !== 'none') {
    out.url = tab.url;
    out.title = tab.title ?? '';
  }
  return out;
}

export function summarizeSession(session: SavedSession, policy: Policy, withTabs: boolean): SessionSummary {
  const summary: SessionSummary = {
    name: session.name,
    kind: session.kind,
    savedAt: new Date(session.savedAt).toISOString(),
    windowCount: session.windows.length,
    tabCount: session.windows.reduce((n, w) => n + w.tabs.length, 0),
  };
  if (withTabs)
    summary.windows = session.windows.map((w) => ({
      tabs: w.tabs.map((t) => summarizeTab(t, policy)),
      groups: w.groups,
    }));
  return summary;
}

// --- the browser's own recently-closed list --------------------------------------------------

export interface RawClosed {
  lastModified?: number;
  tab?: RawSessionTab & { sessionId?: string };
  window?: { sessionId?: string; type?: string; incognito?: boolean; tabs?: RawSessionTab[] };
}

export interface ClosedSummary {
  sessionId: string;
  kind: 'window' | 'tab';
  closedAt: string | null;
  tabs: TabSummary[];
}

/** Chromium reports `lastModified` in seconds, Firefox in milliseconds. */
function closedAt(lastModified: number | undefined): string | null {
  if (typeof lastModified !== 'number' || !Number.isFinite(lastModified) || lastModified <= 0) return null;
  return new Date(lastModified < 1e11 ? lastModified * 1000 : lastModified).toISOString();
}

/** The browser's recently-closed windows and tabs, redacted like `tabs.list`. */
export function summarizeClosed(items: RawClosed[], policy: Policy): ClosedSummary[] {
  const out: ClosedSummary[] = [];
  for (const item of items) {
    const summarize = (t: RawSessionTab) =>
      summarizeTab({ url: t.url || t.pendingUrl, title: t.title, pinned: t.pinned }, policy);
    if (item.window) {
      // A closed popup (beifahrer's own confirmation window among them) or private window is not
      // the person's work to restore.
      if (typeof item.window.sessionId !== 'string' || item.window.incognito === true) continue;
      if (item.window.type !== undefined && item.window.type !== 'normal') continue;
      out.push({
        sessionId: item.window.sessionId,
        kind: 'window',
        closedAt: closedAt(item.lastModified),
        tabs: (item.window.tabs ?? []).map(summarize),
      });
    } else if (item.tab && typeof item.tab.sessionId === 'string') {
      out.push({
        sessionId: item.tab.sessionId,
        kind: 'tab',
        closedAt: closedAt(item.lastModified),
        tabs: [summarize(item.tab)],
      });
    }
  }
  return out;
}
