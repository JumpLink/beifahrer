/**
 * Saved sessions in the browser: storage, capture, restore, and the automatic snapshots.
 *
 * They live in `storage.local` of this browser profile, next to the policy — never on the bridge
 * (ADR 0004). The model and every decision about it are in `@beifahrer/core` (sessions.ts); this
 * file only talks to the browser. The options page uses it directly, the agent through
 * handlers.ts, so the person can save and restore without any agent running.
 */

import { browser } from '@wxt-dev/browser';
import {
  addAutosave,
  autosaveName,
  parseSessions,
  restorePlan,
  snapshot,
  type Policy,
  type RawClosed,
  type RawGroup,
  type RawWindow,
  type SavedSession,
  type SavedWindow,
  type SessionKind,
} from '@beifahrer/core';
import { loadSettings } from './settings.ts';

const KEY = 'sessions';

/** Storage writes go one at a time: an autosave landing between a read and a write would be lost. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function loadSessions(): Promise<SavedSession[]> {
  const raw = await browser.storage.local.get(KEY);
  return parseSessions(raw[KEY]);
}

/** Read, change, write — serialized. `change` returns null to leave storage alone. */
export function updateSessions(
  change: (sessions: SavedSession[]) => SavedSession[] | null,
): Promise<SavedSession[]> {
  return serialized(async () => {
    const current = await loadSessions();
    const next = change(current);
    if (next) await browser.storage.local.set({ [KEY]: next });
    return next ?? current;
  });
}

// --- tab groups: present in Chromium and Firefox ≥ 139, absent elsewhere ------------------------

interface GroupApi {
  group(options: {
    tabIds: number[];
    groupId?: number;
    createProperties?: { windowId?: number };
  }): Promise<number>;
  ungroup(tabIds: number[]): Promise<void>;
}
interface TabGroupsApi {
  query(q: object): Promise<RawGroup[]>;
  update(groupId: number, props: { title?: string; color?: string; collapsed?: boolean }): Promise<unknown>;
}

/** Looked up per call, like captureVisibleTab: the API may appear with a browser update. */
export function groupApi(): GroupApi | null {
  const tabs = browser.tabs as unknown as Partial<GroupApi>;
  return typeof tabs.group === 'function' && typeof tabs.ungroup === 'function'
    ? {
        group: (o) => tabs.group!(o),
        ungroup: (ids) => tabs.ungroup!(ids),
      }
    : null;
}

export function tabGroupsApi(): TabGroupsApi | null {
  const api = (browser as unknown as { tabGroups?: Partial<TabGroupsApi> }).tabGroups;
  return api && typeof api.query === 'function' && typeof api.update === 'function'
    ? (api as TabGroupsApi)
    : null;
}

// --- capture ---------------------------------------------------------------------------------

/** The person's normal windows, with tabs, and the tab groups where the browser has them. */
async function currentWindows(): Promise<{ windows: RawWindow[]; groups: RawGroup[] }> {
  const windows = (await browser.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  })) as unknown as RawWindow[];
  const groups =
    (await tabGroupsApi()
      ?.query({})
      .catch(() => [])) ?? [];
  return { windows, groups };
}

/**
 * Snapshot of the given windows (or all), as a session. `unknownWindow` names an id that is not
 * an open normal window — the caller turns it into not_found.
 */
export async function capture(
  name: string,
  kind: SessionKind,
  windowIds?: number[],
): Promise<{ session: SavedSession; skipped: number; unknownWindow?: number }> {
  const { windows, groups } = await currentWindows();
  let chosen = windows;
  if (windowIds) {
    const missing = windowIds.find((id) => !windows.some((w) => w.id === id));
    if (missing !== undefined)
      return { ...snapshot([], [], { name, kind, now: Date.now() }), unknownWindow: missing };
    chosen = windows.filter((w) => windowIds.includes(w.id!));
  }
  return snapshot(chosen, groups, { name, kind, now: Date.now() });
}

// --- restore ---------------------------------------------------------------------------------

/**
 * Open one tab without loading it where the browser allows that. Firefox creates "discarded" tabs
 * (a label, no page) — but not pinned ones. Chromium has no such option at creation; its tabs
 * load and are discarded once their URL has committed, so forty restored tabs do not all stay
 * in memory.
 */
async function openLazy(
  windowId: number,
  tab: { url: string; pinned: boolean; title?: string },
): Promise<number | undefined> {
  if (!tab.pinned) {
    try {
      const created = await browser.tabs.create({
        windowId,
        url: tab.url,
        active: false,
        discarded: true,
        ...(tab.title ? { title: tab.title } : {}),
      } as Parameters<typeof browser.tabs.create>[0]);
      return created.id;
    } catch {
      // Chromium rejects the unknown `discarded` key; fall through to a plain tab.
    }
  }
  const created = await browser.tabs.create({ windowId, url: tab.url, active: false, pinned: tab.pinned });
  if (created.id !== undefined && !tab.pinned) void discardWhenCommitted(created.id);
  return created.id;
}

async function discardWhenCommitted(tabId: number): Promise<void> {
  // Only a tab with a committed URL is discarded: one without has nothing to come back to.
  for (let i = 0; i < 50; i++) {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab || tab.active) return;
    if (tab.url && tab.status === 'complete') {
      await browser.tabs.discard(tabId).catch(() => undefined);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Put restored tabs back into their groups — best effort: without a group API they stay ungrouped. */
async function regroup(windowId: number, win: SavedWindow, tabIds: (number | undefined)[]): Promise<void> {
  const api = groupApi();
  if (!api || win.groups.length === 0) return;
  const groups = tabGroupsApi();
  for (let g = 0; g < win.groups.length; g++) {
    const ids = win.tabs
      .map((t, i) => (t.group === g && !t.pinned ? tabIds[i] : undefined))
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) continue;
    try {
      const groupId = await api.group({ tabIds: ids, createProperties: { windowId } });
      const { title, color, collapsed } = win.groups[g]!;
      await groups?.update(groupId, { title, ...(color ? { color } : {}), collapsed: collapsed === true });
    } catch {
      // A group that cannot be recreated leaves its tabs open and ungrouped — never lost.
    }
  }
}

async function openWindow(win: SavedWindow): Promise<{ windowId: number; opened: number }> {
  const [first, ...rest] = win.tabs;
  const created = await browser.windows.create({ url: first!.url });
  const windowId = created!.id!;
  const firstId = created!.tabs?.[0]?.id;
  if (first!.pinned && firstId !== undefined) await browser.tabs.update(firstId, { pinned: true });
  const ids: (number | undefined)[] = [firstId];
  for (const tab of rest) ids.push(await openLazy(windowId, tab).catch(() => undefined));
  await regroup(windowId, win, ids);
  return { windowId, opened: ids.filter((id) => id !== undefined).length };
}

async function focusedNormalWindow(): Promise<number | null> {
  const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return win?.id ?? null;
}

export async function restoreSession(
  session: SavedSession,
  policy: Policy,
  into: 'new-windows' | 'current' = 'new-windows',
): Promise<{ windowIds: number[]; opened: number; skipped: number }> {
  const plan = restorePlan(session, policy);
  const current = into === 'current' ? await focusedNormalWindow() : null;
  const windowIds: number[] = [];
  let opened = 0;
  for (const win of plan.windows) {
    if (current === null) {
      const r = await openWindow(win);
      windowIds.push(r.windowId);
      opened += r.opened;
    } else {
      const ids: (number | undefined)[] = [];
      for (const tab of win.tabs) ids.push(await openLazy(current, tab).catch(() => undefined));
      await regroup(current, win, ids);
      opened += ids.filter((id) => id !== undefined).length;
      if (!windowIds.includes(current)) windowIds.push(current);
    }
  }
  return { windowIds, opened, skipped: plan.skipped };
}

// --- the browser's recently-closed list -------------------------------------------------------

interface SessionsApi {
  getRecentlyClosed(filter?: { maxResults?: number }): Promise<RawClosed[]>;
  restore(sessionId?: string): Promise<RawClosed>;
}

export function sessionsApi(): SessionsApi | null {
  const api = (browser as unknown as { sessions?: Partial<SessionsApi> }).sessions;
  return api && typeof api.getRecentlyClosed === 'function' && typeof api.restore === 'function'
    ? (api as SessionsApi)
    : null;
}

// --- automatic snapshots -----------------------------------------------------------------------

const AUTOSAVE_ALARM = 'beifahrer-autosave';
const DEBOUNCE_MS = 10_000;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function autosaveNow(): Promise<void> {
  const { autosave } = await loadSettings();
  if (!autosave) return;
  const now = Date.now();
  const { session } = await capture(autosaveName(now), 'auto');
  await updateSessions((sessions) => addAutosave(sessions, session));
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void autosaveNow().catch(() => undefined), DEBOUNCE_MS);
}

/**
 * Snapshots after every change to tabs or windows (debounced) and every five minutes. Registered
 * synchronously at the top level — see background.ts. `addAutosave` skips a snapshot identical
 * to the newest one, so an idle browser does not rotate the useful ones out.
 */
export function installAutosave(): void {
  browser.tabs.onCreated.addListener(schedule);
  browser.tabs.onRemoved.addListener(schedule);
  browser.tabs.onMoved.addListener(schedule);
  browser.tabs.onAttached.addListener(schedule);
  browser.tabs.onUpdated.addListener((_id, change) => {
    const c = change as { url?: string; pinned?: boolean; groupId?: number };
    if (c.url !== undefined || c.pinned !== undefined || c.groupId !== undefined) schedule();
  });
  browser.windows.onCreated.addListener(schedule);
  browser.windows.onRemoved.addListener(schedule);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTOSAVE_ALARM) void autosaveNow().catch(() => undefined);
  });
  void browser.alarms.create(AUTOSAVE_ALARM, { periodInMinutes: 5 });
}
