/**
 * What each protocol method does in the browser — and the gate in front of every one of them.
 *
 * Order for every method, and it is the whole security model:
 *   1. paused? (`preflight`, in `runMethod`) — the person's kill switch refuses everything;
 *   2. the feature switch (`preflight`, in `runMethod`) — one per capability (features.ts);
 *   3. the policy (`decide`) — the person's per-origin level;
 *   4. the browser's own host permission — granted by the browser's prompt when the person raised
 *      the level, so even a policy bug cannot reach an origin the browser never opened up;
 *   5. for writes, the confirmation window, unless switched off for that origin.
 * Only then is the page agent injected.
 */

import { browser } from '@wxt-dev/browser';
import {
  MAX_WAIT_MS,
  decide,
  originOf,
  preflight,
  preflightMessage,
  parseElementQuery,
  parseMetaQuery,
  type ElementQuery,
  toTabInfo,
  withRule,
  type Method,
  type Params,
  type Policy,
  type Result,
  type TabInfo,
} from '@beifahrer/core';
import { track } from './activity.ts';
import { askPerson } from './confirm.ts';
import { fail } from './errors.ts';
import { hideIndicator } from './indicator.ts';
import { askPage } from './inject.ts';
import { loadSettings, originPattern, saveSettings } from './settings.ts';
import type { PageRequest } from './page-messages.ts';
import { groupApi, sessionsApi } from './sessions-store.ts';
import { tabHandlers } from './tab-handlers.ts';

export { MethodError } from './errors.ts';

const MAX_TEXT = 100_000;

function tabIdOf(params: unknown): number {
  const tabId = (params as { tabId?: unknown } | null)?.tabId;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId))
    return fail('invalid', 'tabId must be an integer');
  return tabId;
}

function refOf(params: unknown): string {
  const ref = (params as { ref?: unknown } | null)?.ref;
  if (typeof ref !== 'string' || !/^e\d+$/.test(ref))
    return fail('invalid', 'ref must look like e12 — take it from page_outline');
  return ref;
}

async function focusedWindowId(): Promise<number | null> {
  try {
    const win = await browser.windows.getLastFocused();
    return win?.id ?? null;
  } catch {
    // Epiphany implements windows.getLastFocused, but a browser with no window open (all closed,
    // background still alive) rejects instead of answering null. "No window" is a real answer here.
    return null;
  }
}

async function getTab(tabId: number) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return fail('not_found', `no tab ${tabId} — call tabs_list for current ids`);
  }
}

async function hasHostPermission(origin: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(origin)] });
}

/** Steps 1 and 2 of the gate. Returns the origin and whether a write must be confirmed. */
async function gate(
  method: Method,
  url: string | undefined,
  policy: Policy,
): Promise<{ origin: string; confirm: boolean }> {
  const decision = decide(policy, method, url);
  if (!decision.allow) {
    const where = decision.origin ?? 'this page';
    return fail(
      'forbidden',
      decision.origin
        ? `${where} is at level "${decision.have}" in beifahrer; ${method} needs "${decision.need}". ` +
            'Ask the person to raise it in the beifahrer toolbar popup on that tab.'
        : `${method} is not possible on a non-web page (browser-internal, local file or extension page).`,
      { origin: decision.origin, have: decision.have, need: decision.need },
    );
  }
  const origin = originOf(url)!;
  if (!(await hasHostPermission(origin))) {
    return fail(
      'forbidden',
      `the browser has not granted beifahrer access to ${origin} (the level is set, the browser permission is ` +
        'missing — it was probably revoked in the browser settings). Ask the person to set the level again in the popup.',
      { origin },
    );
  }
  return { origin, confirm: decision.confirm };
}

/** Who sent the request being served: the agent session, as the person sees it (ADR 0007). */
export interface CallContext {
  session?: string;
}

async function page(tabId: number, ctx: CallContext, req: PageRequest): Promise<Record<string, unknown>> {
  // The session names itself on the in-page pill.
  const res = await askPage(tabId, ctx.session ? { ...req, session: ctx.session } : req).catch((err: Error) =>
    fail('failed', `could not reach the page: ${err.message}`),
  );
  if (!res.ok) return fail(res.code, res.message);
  return res.data;
}

async function confirmWrite(
  ctx: CallContext,
  tabId: number,
  origin: string,
  action: 'fill' | 'click',
  ref: string,
  text: string | undefined,
): Promise<void> {
  const target = String((await page(tabId, ctx, { beifahrer: 'describe', ref })).description ?? ref);
  const answer = await askPerson({ origin, action, target, text });
  if (!answer.allow)
    fail('denied', `the person declined the ${action} on ${origin} (or did not answer within two minutes)`);
  if (answer.remember) {
    const { policy } = await loadSettings();
    await saveSettings({ policy: withRule(policy, origin, { level: 'write', confirmWrites: false }) });
  }
}

/** A query from the agent, validated with the same rules a recipe's queries are (find.ts). */
function queryOf(raw: unknown): ElementQuery {
  const query = parseElementQuery(raw);
  return typeof query === 'string' ? fail('invalid', query) : query;
}

/** Only the query keys of a `page.find` call — tabId and the options are not part of it. */
function findQueryOf(params: Record<string, unknown>): ElementQuery {
  const { tabId: _t, maxResults: _m, meta: _meta, browser: _b, ...query } = params;
  return queryOf(query);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the tab's document has loaded. Polls `tabs.get`: Epiphany fires no
 * `tabs.onUpdated`, so polling is the one path that works everywhere (issue #2).
 */
async function waitForLoad(tabId: number, deadline: number): Promise<void> {
  for (;;) {
    const tab = await getTab(tabId);
    if (tab.status === 'complete') return;
    if (Date.now() >= deadline) fail('timeout', `tab ${tabId} did not finish loading in time`);
    await sleep(200);
  }
}

type Handler<M extends Method> = (params: Params<M>, policy: Policy, ctx: CallContext) => Promise<Result<M>>;

const handlers: { [M in Method]: Handler<M> } = {
  async 'tabs.list'(_params, policy) {
    const [tabs, focused] = await Promise.all([browser.tabs.query({}), focusedWindowId()]);
    return {
      tabs: tabs
        // Chromium: a tab still loading has an empty `url` and its target in `pendingUrl`.
        .map((t) => toTabInfo({ ...t, url: t.url || t.pendingUrl }, policy, focused))
        .filter((t): t is TabInfo => t !== null),
    };
  },

  async 'tabs.active'(_params, policy) {
    const focused = await focusedWindowId();
    const query =
      focused !== null ? { active: true, windowId: focused } : { active: true, currentWindow: true };
    const [tab] = await browser.tabs.query(query);
    return { tab: tab ? toTabInfo(tab, policy, focused) : null };
  },

  async 'page.read'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.read', tab.url, policy);
    const maxChars = Math.min(Math.max(Number(params.maxChars) || 20_000, 100), 200_000);
    return (await page(tabId, ctx, { beifahrer: 'read', maxChars })) as unknown as Result<'page.read'>;
  },

  async 'page.outline'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.outline', tab.url, policy);
    const maxItems = Math.min(Math.max(Number(params.maxItems) || 400, 10), 2_000);
    return (await page(tabId, ctx, { beifahrer: 'outline', maxItems })) as unknown as Result<'page.outline'>;
  },

  async 'page.find'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const raw = params as unknown as Record<string, unknown>;
    const tab = await getTab(tabId);
    await gate('page.find', tab.url, policy);
    if (raw.meta !== undefined) {
      const meta = parseMetaQuery(raw.meta);
      if (typeof meta === 'string') return fail('invalid', meta);
      return (await page(tabId, ctx, { beifahrer: 'meta', meta })) as unknown as Result<'page.find'>;
    }
    const query = findQueryOf(raw);
    const maxResults = Math.min(Math.max(Number(params.maxResults) || 20, 1), 200);
    return (await page(tabId, ctx, {
      beifahrer: 'find',
      query,
      maxResults,
    })) as unknown as Result<'page.find'>;
  },

  async 'page.wait'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const started = Date.now();
    const timeoutMs = Math.min(Math.max(Number(params.timeoutMs) || 10_000, 100), MAX_WAIT_MS);
    const deadline = started + timeoutMs;
    const query = params.for === 'load' ? null : queryOf(params.for);
    const tab = await getTab(tabId);
    // Chromium: a tab still loading has an empty `url` and its target in `pendingUrl`. Firefox
    // shows `about:blank` until the first response arrives: there is no site to ask the policy
    // about yet, so the load is awaited first — and the gate asked for where the tab landed.
    // Waiting reveals nothing about a page; the answer is only "loaded", after the gate.
    const blank = tab.status !== 'complete' && (!tab.url || tab.url === 'about:blank') && !tab.pendingUrl;
    if (!blank) await gate('page.wait', tab.url || tab.pendingUrl, policy);
    await waitForLoad(tabId, deadline);
    if (blank) await gate('page.wait', (await getTab(tabId)).url, policy);
    if (!query) return { waitedMs: Date.now() - started };
    // The document may have navigated while it loaded: the gate is asked again for where it is NOW.
    const loaded = await getTab(tabId);
    await gate('page.wait', loaded.url, policy);
    const left = Math.max(deadline - Date.now(), 100);
    const data = await page(tabId, ctx, { beifahrer: 'wait', query, timeoutMs: left });
    return { waitedMs: Date.now() - started, match: data.match as Result<'page.wait'>['match'] };
  },

  async 'page.screenshot'(params, policy) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.screenshot', tab.url, policy);
    // Looked up NOW, not at hello time: Firefox only defines captureVisibleTab once `<all_urls>`
    // is granted, and the person may switch screenshots on while connected.
    if (typeof browser.tabs.captureVisibleTab !== 'function') {
      const granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
      return granted
        ? fail('unsupported', 'this browser cannot take screenshots')
        : fail(
            'forbidden',
            'screenshots are switched off — the person can allow them in the beifahrer options',
          );
    }
    // The API captures what the window shows, not a tab of our choosing — refusing is honest,
    // switching the person's tab behind their back is not.
    if (!tab.active) {
      return fail(
        'invalid',
        `tab ${tabId} is not the visible tab of its window; screenshots show only what is on screen`,
      );
    }
    // The in-page pill must never end up in the picture: the agent would see beifahrer's own UI.
    await hideIndicator(tabId);
    try {
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { dataUrl };
    } catch (err) {
      return fail(
        'forbidden',
        `the browser refused the screenshot (${(err as Error).message}). Screenshots need the extra "all sites" grant — ` +
          'the person can switch them on in the beifahrer options.',
      );
    }
  },

  async 'page.fill'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    if (typeof params.text !== 'string') return fail('invalid', 'text must be a string');
    if (params.text.length > MAX_TEXT) return fail('invalid', `text is longer than ${MAX_TEXT} characters`);
    const as = params.as === 'html' ? 'html' : 'text';
    const mode = params.mode === 'append' ? 'append' : 'replace';
    const tab = await getTab(tabId);
    const { origin, confirm } = await gate('page.fill', tab.url, policy);
    if (confirm) await confirmWrite(ctx, tabId, origin, 'fill', ref, params.text);
    return (await page(tabId, ctx, {
      beifahrer: 'fill',
      ref,
      text: params.text,
      as,
      mode,
    })) as unknown as Result<'page.fill'>;
  },

  async 'page.click'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    const tab = await getTab(tabId);
    const { origin, confirm } = await gate('page.click', tab.url, policy);
    if (confirm) await confirmWrite(ctx, tabId, origin, 'click', ref, undefined);
    return (await page(tabId, ctx, { beifahrer: 'click', ref })) as unknown as Result<'page.click'>;
  },

  async 'tabs.open'(params, policy) {
    if (typeof params.url !== 'string') return fail('invalid', 'url must be a string');
    const decision = decide(policy, 'tabs.open', params.url);
    if (!decision.allow) {
      return fail(
        'forbidden',
        `opening ${decision.origin ?? params.url} needs level "read" on that site; it is "${decision.have}". ` +
          'Ask the person to allow the site first.',
        { origin: decision.origin, have: decision.have, need: decision.need },
      );
    }
    const tab = await browser.tabs.create({ url: params.url, active: params.active !== false });
    const info = toTabInfo({ ...tab, url: tab.url || params.url }, policy, await focusedWindowId());
    if (!info) return fail('failed', 'the browser opened no tab');
    return { tab: info };
  },

  ...tabHandlers,
};

export async function runMethod(method: Method, params: unknown, ctx: CallContext = {}): Promise<unknown> {
  return track(method, params, run, ctx.session);
  async function run(): Promise<unknown> {
    const { policy, paused, features } = await loadSettings();
    // Pause, then the feature switch: before any handler, so none can forget them (features.ts).
    const pre = preflight({ paused, features }, method);
    if (!pre.allow) {
      return fail(
        pre.code,
        preflightMessage(pre, method),
        pre.code === 'feature_disabled' ? { feature: pre.feature } : {},
      );
    }
    const handler = handlers[method] as Handler<Method>;
    return handler((params ?? {}) as Params<Method>, policy, ctx);
  }
}

/**
 * Every method this build implements. Whether one works right now (a grant, a policy level) is
 * answered per call, with a reason — a capability list frozen at hello time went stale the moment
 * the person changed a setting.
 */
/**
 * Methods that rest on an API not every engine has. The hello leaves them out where it is missing,
 * so the agent never sees a tool the browser cannot serve: Safari 27 has neither `tabGroups` nor
 * `sessions`, and still announced all four until this filter existed.
 */
const NEEDS_API: Partial<Record<Method, () => boolean>> = {
  'tabs.group': () => groupApi() !== null,
  'tabs.ungroup': () => groupApi() !== null,
  'sessions.recentlyClosed': () => sessionsApi() !== null,
  'sessions.restoreClosed': () => sessionsApi() !== null,
};

export function capabilities(): Method[] {
  return (Object.keys(handlers) as Method[]).filter((m) => NEEDS_API[m]?.() ?? true);
}
