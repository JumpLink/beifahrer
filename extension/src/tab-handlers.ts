/**
 * Tab and window management, and saved sessions — the methods behind the browser-level grant
 * "Let the agent manage tabs and windows".
 *
 * `runMethod` (handlers.ts) checks that grant before any of these runs, so none of them repeats
 * it. What each one still checks itself:
 * - a NEW URL the agent supplies needs level `read` on its site (the `tabs.open` rule);
 * - closing tabs asks the person, unless they switched that off;
 * - whatever comes back about a tab is redacted like `tabs.list`.
 */

import { browser } from '@wxt-dev/browser';
import {
  GROUP_COLORS,
  decide,
  defineSession,
  hostOf,
  levelFor,
  sessionNameError,
  summarizeClosed,
  summarizeSession,
  toTabInfo,
  upsertSession,
  type GroupColor,
  type Method,
  type Params,
  type Policy,
  type RawClosed,
  type Result,
  type TabInfo,
} from '@beifahrer/core';
import { askPerson } from './confirm.ts';
import { fail } from './errors.ts';
import {
  capture,
  groupApi,
  loadSessions,
  restoreSession,
  sessionsApi,
  tabGroupsApi,
  updateSessions,
} from './sessions-store.ts';
import { loadSettings, saveSettings } from './settings.ts';

type TabMethod =
  | 'tabs.move'
  | 'tabs.pin'
  | 'tabs.close'
  | 'tabs.group'
  | 'tabs.ungroup'
  | 'windows.create'
  | 'sessions.save'
  | 'sessions.list'
  | 'sessions.restore'
  | 'sessions.delete'
  | 'sessions.define'
  | 'sessions.recentlyClosed'
  | 'sessions.restoreClosed';

type Handler<M extends Method> = (params: Params<M>, policy: Policy) => Promise<Result<M>>;

const MAX_IDS = 500;

function intArray(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS)
    return fail('invalid', `${what} must be a non-empty array of at most ${MAX_IDS} ids`);
  for (const v of value)
    if (typeof v !== 'number' || !Number.isInteger(v)) return fail('invalid', `${what} must hold integers`);
  return value as number[];
}

function optionalInt(value: unknown, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value))
    return fail('invalid', `${what} must be an integer`);
  return value;
}

function nameOf(params: unknown): string {
  const name = (params as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || name.length === 0)
    return fail('invalid', 'name must be a non-empty string');
  return name;
}

async function focusedWindowId(): Promise<number | null> {
  const win = await browser.windows.getLastFocused().catch(() => null);
  return win?.id ?? null;
}

type RawTab = Parameters<typeof toTabInfo>[0] & { pendingUrl?: string };

/** Chromium reports a tab that is still loading with an empty `url` and the target in `pendingUrl`. */
function info(tab: RawTab, policy: Policy, focused: number | null): TabInfo | null {
  return toTabInfo({ ...tab, url: tab.url || tab.pendingUrl }, policy, focused);
}

async function tabInfos(tabIds: number[], policy: Policy): Promise<TabInfo[]> {
  const focused = await focusedWindowId();
  const tabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id).catch(() => null)));
  return tabs
    .map((t) => (t ? info(t as RawTab, policy, focused) : null))
    .filter((t): t is TabInfo => t !== null);
}

async function existingTabs(tabIds: number[]) {
  return Promise.all(
    tabIds.map((id) =>
      browser.tabs.get(id).catch(() => fail('not_found', `no tab ${id} — call tabs_list for current ids`)),
    ),
  );
}

/** Refuse a URL the agent supplies unless its site is at `read` — the `tabs.open` rule. */
function checkNewUrl(method: Method, url: unknown, policy: Policy): string {
  if (typeof url !== 'string') return fail('invalid', 'url must be a string');
  const decision = decide(policy, method, url);
  if (!decision.allow) {
    return fail(
      'forbidden',
      `opening ${decision.origin ?? url} needs level "read" on that site; it is "${decision.have}". ` +
        'Ask the person to allow the site first.',
      { origin: decision.origin, have: decision.have, need: decision.need },
    );
  }
  return url;
}

/** One line per tab for the confirmation window — the same redaction the agent gets. */
function describeForPerson(tab: { url?: string; title?: string }, policy: Policy): string {
  const host = hostOf(tab.url);
  if (!host) return 'a browser page (not a website)';
  if (levelFor(policy, tab.url) === 'none') return host;
  return tab.title ? `${tab.title} — ${host}` : host;
}

export const tabHandlers: { [M in TabMethod]: Handler<M> } = {
  async 'tabs.move'(params, policy) {
    const tabIds = intArray(params.tabIds, 'tabIds');
    const index = optionalInt(params.index, 'index');
    if (index === undefined || index < -1) return fail('invalid', 'index must be an integer ≥ -1 (-1 = end)');
    const windowId = optionalInt(params.windowId, 'windowId');
    await existingTabs(tabIds);
    try {
      await browser.tabs.move(tabIds, { index, ...(windowId !== undefined ? { windowId } : {}) });
    } catch (err) {
      return fail('failed', `the browser refused the move: ${(err as Error).message}`);
    }
    return { tabs: await tabInfos(tabIds, policy) };
  },

  async 'tabs.pin'(params, policy) {
    const tabIds = intArray(params.tabIds, 'tabIds');
    if (typeof params.pinned !== 'boolean') return fail('invalid', 'pinned must be true or false');
    await existingTabs(tabIds);
    for (const id of tabIds) await browser.tabs.update(id, { pinned: params.pinned });
    return { tabs: await tabInfos(tabIds, policy) };
  },

  async 'tabs.close'(params, policy) {
    const windowId = optionalInt(params.windowId, 'windowId');
    const hasIds = params.tabIds !== undefined;
    if (hasIds === (windowId !== undefined)) return fail('invalid', 'give either tabIds or windowId');
    const tabs = hasIds
      ? await existingTabs(intArray(params.tabIds, 'tabIds'))
      : await browser.tabs.query({ windowId: windowId! });
    if (tabs.length === 0) return fail('not_found', `no window ${windowId} with tabs`);
    const ids = tabs.map((t) => t.id!).filter((id) => id !== undefined);
    const { confirmClose } = await loadSettings();
    if (confirmClose) {
      const answer = await askPerson({
        origin: '',
        action: 'close',
        target: windowId !== undefined ? `a window with ${ids.length} tab(s)` : `${ids.length} tab(s)`,
        items: tabs.map((t) => describeForPerson(t, policy)),
      });
      if (!answer.allow)
        return fail('denied', 'the person declined closing the tabs (or did not answer within two minutes)');
      if (answer.remember) await saveSettings({ confirmClose: false });
    }
    // A whole window is closed as a window: the browser then remembers it as ONE entry in its
    // recently-closed list, restorable in one step, instead of as N single tabs.
    if (windowId !== undefined) await browser.windows.remove(windowId);
    else await browser.tabs.remove(ids);
    return { closed: ids.length };
  },

  async 'tabs.group'(params) {
    const api = groupApi();
    if (!api) return fail('unsupported', 'this browser has no tab groups (Chromium, Firefox ≥ 139 do)');
    const tabIds = intArray(params.tabIds, 'tabIds');
    const groupId = optionalInt(params.groupId, 'groupId');
    if (params.title !== undefined && (typeof params.title !== 'string' || params.title.length > 100))
      return fail('invalid', 'title must be a string of at most 100 characters');
    if (params.color !== undefined && !GROUP_COLORS.includes(params.color as GroupColor))
      return fail('invalid', `color must be one of ${GROUP_COLORS.join(', ')}`);
    await existingTabs(tabIds);
    let id: number;
    try {
      id = await api.group({ tabIds, ...(groupId !== undefined ? { groupId } : {}) });
    } catch (err) {
      return fail('failed', `the browser refused to group: ${(err as Error).message}`);
    }
    const props = {
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.color !== undefined ? { color: params.color } : {}),
      ...(params.collapsed !== undefined ? { collapsed: params.collapsed === true } : {}),
    };
    if (Object.keys(props).length) {
      const groups = tabGroupsApi();
      if (!groups)
        return fail('unsupported', 'tabs were grouped, but this browser cannot name or colour groups');
      await groups.update(id, props);
    }
    return { groupId: id };
  },

  async 'tabs.ungroup'(params, policy) {
    const api = groupApi();
    if (!api) return fail('unsupported', 'this browser has no tab groups (Chromium, Firefox ≥ 139 do)');
    const tabIds = intArray(params.tabIds, 'tabIds');
    await existingTabs(tabIds);
    await api.ungroup(tabIds);
    return { tabs: await tabInfos(tabIds, policy) };
  },

  async 'windows.create'(params, policy) {
    const newTabs = params.tabs ?? [];
    if (!Array.isArray(newTabs) || newTabs.length > MAX_IDS) return fail('invalid', 'tabs must be an array');
    const urls = newTabs.map((t) => checkNewUrl('windows.create', (t as { url?: unknown })?.url, policy));
    const moved = params.tabIds === undefined ? [] : intArray(params.tabIds, 'tabIds');
    if (urls.length + moved.length === 0)
      return fail('invalid', 'give tabs to open, tabIds to move, or both');
    await existingTabs(moved);
    const win = await browser.windows.create(moved.length ? { tabId: moved[0] } : { url: urls[0] });
    const windowId = win!.id!;
    if (moved.length > 1) await browser.tabs.move(moved.slice(1), { windowId, index: -1 });
    const firstNew = moved.length ? 0 : 1;
    for (let i = firstNew; i < urls.length; i++)
      await browser.tabs.create({ windowId, url: urls[i], active: false });
    const pinned = newTabs
      .map((t, i) => ((t as { pinned?: unknown }).pinned === true ? i : -1))
      .filter((i) => i >= 0);
    if (pinned.length) {
      const all = await browser.tabs.query({ windowId });
      const created = all.sort((a, b) => a.index - b.index).slice(moved.length);
      for (const i of pinned) {
        const id = created[i]?.id;
        if (id !== undefined) await browser.tabs.update(id, { pinned: true });
      }
    }
    const focused = await focusedWindowId();
    const tabs = (await browser.tabs.query({ windowId }))
      .map((t) => info(t as RawTab, policy, focused))
      .filter((t): t is TabInfo => t !== null);
    return { windowId, tabs };
  },

  async 'sessions.save'(params, policy) {
    const name = nameOf(params);
    const nameError = sessionNameError(name);
    if (nameError) return fail('invalid', nameError);
    let windowIds: number[] | undefined;
    if (params.windows !== undefined && params.windows !== 'all')
      windowIds = intArray(params.windows, 'windows');
    const { session, skipped, unknownWindow } = await capture(name, 'saved', windowIds);
    if (unknownWindow !== undefined)
      return fail('not_found', `no open window ${unknownWindow} — tabs_list shows the window ids`);
    if (session.windows.length === 0) return fail('invalid', 'there is no web page open to save');
    await updateSessions((sessions) => upsertSession(sessions, session));
    return { session: summarizeSession(session, policy, true), skipped };
  },

  async 'sessions.list'(params, policy) {
    const name = params.name;
    if (name !== undefined && typeof name !== 'string') return fail('invalid', 'name must be a string');
    const sessions = (await loadSessions())
      .filter((s) => name === undefined || s.name === name)
      .sort((a, b) => b.savedAt - a.savedAt);
    if (name !== undefined && sessions.length === 0) return fail('not_found', `no saved session "${name}"`);
    // The automatic snapshots come as counts only unless asked for by name: twenty copies of
    // every open tab would drown the list.
    return {
      sessions: sessions.map((s) => summarizeSession(s, policy, name !== undefined || s.kind !== 'auto')),
    };
  },

  async 'sessions.restore'(params, policy) {
    const name = nameOf(params);
    const into = params.into ?? 'new-windows';
    if (into !== 'new-windows' && into !== 'current')
      return fail('invalid', 'into must be new-windows or current');
    const session = (await loadSessions()).find((s) => s.name === name);
    if (!session) return fail('not_found', `no saved session "${name}" — sessions_list shows the names`);
    return restoreSession(session, policy, into);
  },

  async 'sessions.delete'(params) {
    const name = nameOf(params);
    let deleted = false;
    await updateSessions((sessions) => {
      const next = sessions.filter((s) => s.name !== name);
      deleted = next.length !== sessions.length;
      return deleted ? next : null;
    });
    return { deleted };
  },

  async 'sessions.define'(params, policy) {
    const result = defineSession(params, policy, Date.now());
    if (!result.ok) {
      const { code, message, ...extra } = result;
      return fail(code, message, extra);
    }
    await updateSessions((sessions) => upsertSession(sessions, result.session));
    return { session: summarizeSession(result.session, policy, true) };
  },

  async 'sessions.recentlyClosed'(params, policy) {
    const api = sessionsApi();
    if (!api) return fail('unsupported', 'this browser has no recently-closed list for extensions');
    const max = Math.min(Math.max(Number(params.maxResults) || 25, 1), 25);
    const items = await api.getRecentlyClosed({ maxResults: max });
    return { closed: summarizeClosed(items, policy) };
  },

  async 'sessions.restoreClosed'(params, policy) {
    const api = sessionsApi();
    if (!api) return fail('unsupported', 'this browser has no recently-closed list for extensions');
    if (typeof params.sessionId !== 'string' || !params.sessionId)
      return fail('invalid', 'sessionId must be a string from sessions_recently_closed');
    let restored: RawClosed & { window?: { id?: number } };
    try {
      restored = await api.restore(params.sessionId);
    } catch (err) {
      return fail('not_found', `could not restore ${params.sessionId}: ${(err as Error).message}`);
    }
    const focused = await focusedWindowId();
    const raw = (restored.window?.tabs ?? (restored.tab ? [restored.tab] : [])) as RawTab[];
    return {
      ...(restored.window?.id !== undefined ? { windowId: restored.window.id } : {}),
      tabs: raw.map((t) => info(t, policy, focused)).filter((t): t is TabInfo => t !== null),
    };
  },
};
