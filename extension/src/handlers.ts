/**
 * What each protocol method does in the browser — and the gate in front of every one of them.
 *
 * Order for every method, and it is the whole security model:
 *   1. paused? (`preflight`, in `runMethod`) — the person's kill switch refuses everything;
 *   2. the feature switch (`preflight`, in `runMethod`) — one per capability (features.ts);
 *   3. the policy (`decide`) — the person's per-origin level, widened by their temporary grants
 *      (ADR 0010); below it, the person may be asked on demand (access-prompt.ts);
 *   4. the browser's own host permission — granted by the browser's prompt when the person raised
 *      the level, so even a policy bug cannot reach an origin the browser never opened up;
 *   5. for writes, the confirmation window, unless switched off for that origin.
 * Only then is the page agent injected.
 */

import { browser } from '@wxt-dev/browser';
import {
  ALWAYS_CONFIRM,
  MAX_WAIT_MS,
  REQUIRED_LEVEL,
  atLeast,
  decide,
  originOf,
  preflight,
  preflightMessage,
  evaluateRequestOf,
  parseElementQuery,
  parseKeySpec,
  parseKeyTimes,
  parseMetaQuery,
  scriptPreview,
  type ElementQuery,
  toTabInfo,
  withRule,
  type AccessContext,
  type Level,
  type Method,
  type Params,
  type Policy,
  type Result,
  type TabInfo,
} from '@beifahrer/core';
import { askForAccess } from './access-prompt.ts';
import { track } from './activity.ts';
import { askPerson, type ConfirmAnswer } from './confirm.ts';
import { fail } from './errors.ts';
import { hideIndicator } from './indicator.ts';
import { loadGrants, settle } from './grants.ts';
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

/** Who sent the request being served: the agent session, as the person sees it (ADR 0007). */
export interface CallContext {
  /** The session's label (from its bridge: untrusted text, shown only as text). */
  session?: string;
  /** The extension's own id for the session's connection, which session-bound grants name. */
  sessionId?: string;
  /** Set when an "Allow once" let this call through: its host access is given back after it. */
  settleAfter?: boolean;
  /**
   * The origins an "Allow once" opened for THIS call, with their level: `page.wait` passes the
   * gate up to three times, and one call is one "once".
   */
  once?: Map<string, Level>;
}

const accessOf = (ctx: CallContext): AccessContext =>
  ctx.sessionId ? { now: Date.now(), session: ctx.sessionId } : { now: Date.now() };

function refuse(
  method: Method,
  decision: { origin: string | null; have: Level; need: Level; askable?: boolean },
): never {
  const where = decision.origin ?? 'this page';
  return fail(
    'forbidden',
    !decision.origin
      ? `${method} is not possible on a non-web page (browser-internal, local file or extension page).`
      : decision.askable === false
        ? `the person blocked ${where} in beifahrer (level "none"); ${method} needs "${decision.need}". ` +
          'Do not ask for it again unless the person brings it up.'
        : `${where} is at level "${decision.have}" in beifahrer; ${method} needs "${decision.need}". ` +
          'Ask the person to raise it in the beifahrer toolbar popup on that tab.',
    { origin: decision.origin, have: decision.have, need: decision.need },
  );
}

/**
 * Steps 3 and 4 of the gate. Returns the origin and whether a write must be confirmed.
 *
 * Below the site's level, or without the browser's grant for it, the person may be asked
 * (access-prompt.ts) — never for a non-web page or a site they blocked. An access that only a
 * prompt's answer allowed always confirms its writes, like a temporary grant.
 */
async function gate(
  method: Method,
  url: string | undefined,
  policy: Policy,
  ctx: CallContext,
): Promise<{ origin: string; confirm: boolean }> {
  const decision = decide(policy, method, url, accessOf(ctx));
  if (!decision.allow && !decision.askable) return refuse(method, decision);
  const origin = originOf(url)!;
  // Asked on demand is a branch of its own, so it has to carry the ALWAYS_CONFIRM rule itself. It
  // happens to be true there for every write (including a script) because the level IS write — but
  // that is a coincidence of this method's level, not the rule, and a future ALWAYS_CONFIRM method
  // at another level would otherwise pass through unconfirmed.
  const always = ALWAYS_CONFIRM.has(method);
  const granted = await hasHostPermission(origin);
  if (decision.allow && granted) return { origin, confirm: decision.confirm || always };
  const need = decision.allow ? REQUIRED_LEVEL[method]! : decision.need;
  const onceLevel = ctx.once?.get(origin);
  const answer =
    onceLevel && atLeast(onceLevel, need)
      ? 'once'
      : await askForAccess({ label: ctx.session, sessionId: ctx.sessionId }, origin, need);
  if (answer === 'once') {
    ctx.settleAfter = true;
    (ctx.once ??= new Map()).set(origin, need);
  }
  if (answer && (await hasHostPermission(origin)))
    return { origin, confirm: always || (decision.allow ? decision.confirm : need === 'write') };
  if (!decision.allow) return refuse(method, decision);
  return fail(
    'forbidden',
    `the browser has not granted beifahrer access to ${origin} (the level is set, the browser permission is ` +
      'missing — it was probably revoked in the browser settings). Ask the person to set the level again in the popup.',
    { origin },
  );
}

async function page(tabId: number, ctx: CallContext, req: PageRequest): Promise<Record<string, unknown>> {
  // The session names itself on the in-page pill.
  const res = await askPage(tabId, ctx.session ? { ...req, session: ctx.session } : req).catch((err: Error) =>
    fail('failed', `could not reach the page: ${err.message}`),
  );
  if (!res.ok) return fail(res.code, res.message);
  return res.data;
}

/**
 * The sentence the person reads before a write happens, per action.
 *
 * "Fill a field" is not enough for a key press: a press can SUBMIT a form, and the person is the
 * one who has to recognise that from the window. So the keys, the values or the state go into the
 * window, not just the field's name — the same reason a script's whole text is shown (ADR 0012).
 */
type WriteAction = 'fill' | 'click' | 'press' | 'select' | 'check';

/** What the confirm window may show of the agent's own text: enough to judge, never a wall. */
const WINDOW_PREVIEW_CHARS = 200;

function clipForWindow(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > WINDOW_PREVIEW_CHARS ? `${flat.slice(0, WINDOW_PREVIEW_CHARS - 1)}…` : flat;
}

/** "Always allow" on a write: the person says this site needs no asking from now on. */
async function rememberWrites(origin: string): Promise<void> {
  const { policy } = await loadSettings();
  await saveSettings({ policy: withRule(policy, origin, { level: 'write', confirmWrites: false }) });
}

function askWrite(
  origin: string,
  action: WriteAction,
  target: string,
  /** What the person needs to see to judge it: the text, the keys, the values, the new state. */
  detail: string | undefined,
  /** `press`: the detail is text to type rather than a key to press. */
  typed = false,
): Promise<ConfirmAnswer> {
  if (action === 'press') {
    return askPerson({ origin, action, target, text: detail, keys: detail, typed });
  }
  if (action === 'select') {
    return askPerson({ origin, action, target, text: detail, values: detail });
  }
  if (action === 'check') {
    return askPerson({ origin, action, target, state: detail === 'true' ? 'on' : 'off' });
  }
  return askPerson({ origin, action, target, text: detail });
}

async function confirmWrite(
  ctx: CallContext,
  tabId: number,
  origin: string,
  action: WriteAction,
  ref: string,
  detail: string | undefined,
): Promise<void> {
  const target = String((await page(tabId, ctx, { beifahrer: 'describe', ref })).description ?? ref);
  const answer = await askWrite(origin, action, target, detail);
  if (!answer.allow)
    fail('denied', `the person declined the ${action} on ${origin} (or did not answer within two minutes)`);
  if (answer.remember) await rememberWrites(origin);
}

/**
 * Ask before a script runs, showing the person the code (ADR 0012).
 *
 * "An agent wants to run something here" is not a decision anyone can make; the script itself is.
 * The window shows it in full, scrollable — and offers no "Always allow": a site rule must never
 * become a standing permission for code the person has not seen yet. The capability itself is the
 * person's switch, in the browser, and it starts off.
 */
async function confirmScript(ctx: CallContext, origin: string, script: string): Promise<void> {
  const answer = await askPerson({
    origin,
    action: 'script',
    // What is about to happen, in words, for the window's own heading row. The code itself travels
    // in `code` and the window shows that.
    target: scriptPreview(script),
    session: ctx.session,
    code: script,
  });
  if (!answer.allow)
    fail(
      'denied',
      `the person declined the script on ${origin} (or did not answer within two minutes). Do not rephrase and retry: ` +
        'ask them what they want done on this page.',
    );
}

/**
 * Re-check a tab's origin and the person's switches after a window the person had to answer.
 *
 * A confirmation can sit open for two minutes. In that time the tab may navigate — the page can do
 * it itself, and so can the person — so the origin the person said yes to may no longer be the one
 * the call would run in. For `page.fill`/`page.click` a stale ref simply fails afterwards; a script
 * has no ref to go stale, so this is where the check belongs. The pause and the level are re-read
 * for the same reason: Stop pressed while the window was up must stop this call too, which is the
 * promise ADR 0005 makes.
 */
async function stillTheSameOrigin(tabId: number, origin: string, method: Method): Promise<void> {
  const where = (await getTab(tabId)).url;
  const moved = originOf(where);
  if (moved !== origin)
    return fail(
      'forbidden',
      `the tab moved to ${moved ?? 'another page'} while the person was answering. ` +
        `The answer was about ${origin}, so nothing runs here — ask again for where the tab is now.`,
      { origin: moved, need: REQUIRED_LEVEL[method] ?? undefined },
    );
  const { paused } = await loadSettings();
  if (paused) return fail('paused', preflightMessage({ allow: false, code: 'paused' }, method));
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
  async 'tabs.list'(_params, policy, ctx) {
    const [tabs, focused] = await Promise.all([browser.tabs.query({}), focusedWindowId()]);
    return {
      tabs: tabs
        // Chromium: a tab still loading has an empty `url` and its target in `pendingUrl`.
        .map((t) => toTabInfo({ ...t, url: t.url || t.pendingUrl }, policy, focused, accessOf(ctx)))
        .filter((t): t is TabInfo => t !== null),
    };
  },

  async 'tabs.active'(_params, policy, ctx) {
    const focused = await focusedWindowId();
    const query =
      focused !== null ? { active: true, windowId: focused } : { active: true, currentWindow: true };
    const [tab] = await browser.tabs.query(query);
    return { tab: tab ? toTabInfo(tab, policy, focused, accessOf(ctx)) : null };
  },

  async 'page.read'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.read', tab.url, policy, ctx);
    const maxChars = Math.min(Math.max(Number(params.maxChars) || 20_000, 100), 200_000);
    return (await page(tabId, ctx, { beifahrer: 'read', maxChars })) as unknown as Result<'page.read'>;
  },

  async 'page.download'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.download', tab.url, policy, ctx);
    const raw = params as unknown as Record<string, unknown>;
    const ref = typeof raw.ref === 'string' ? raw.ref : undefined;
    const url = typeof raw.url === 'string' ? raw.url : undefined;
    // 10 MB covers a scanned letter or a statement; the ceiling keeps one document from filling
    // the bridge. The page checks it again against the bytes it actually got.
    const maxBytes = Math.min(Math.max(Number(raw.maxBytes) || 10_000_000, 1_000), 25_000_000);
    return (await page(tabId, ctx, {
      beifahrer: 'download',
      ref,
      url,
      maxBytes,
    })) as unknown as Result<'page.download'>;
  },

  async 'page.outline'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.outline', tab.url, policy, ctx);
    const maxItems = Math.min(Math.max(Number(params.maxItems) || 400, 10), 2_000);
    return (await page(tabId, ctx, { beifahrer: 'outline', maxItems })) as unknown as Result<'page.outline'>;
  },

  async 'page.find'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const raw = params as unknown as Record<string, unknown>;
    const tab = await getTab(tabId);
    await gate('page.find', tab.url, policy, ctx);
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
    if (!blank) await gate('page.wait', tab.url || tab.pendingUrl, policy, ctx);
    await waitForLoad(tabId, deadline);
    if (blank) await gate('page.wait', (await getTab(tabId)).url, policy, ctx);
    if (!query) return { waitedMs: Date.now() - started };
    // The document may have navigated while it loaded: the gate is asked again for where it is NOW.
    const loaded = await getTab(tabId);
    await gate('page.wait', loaded.url, policy, ctx);
    const left = Math.max(deadline - Date.now(), 100);
    const data = await page(tabId, ctx, { beifahrer: 'wait', query, timeoutMs: left });
    return { waitedMs: Date.now() - started, match: data.match as Result<'page.wait'>['match'] };
  },

  async 'page.screenshot'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.screenshot', tab.url, policy, ctx);
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
    const { origin, confirm } = await gate('page.fill', tab.url, policy, ctx);
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
    const { origin, confirm } = await gate('page.click', tab.url, policy, ctx);
    if (confirm) await confirmWrite(ctx, tabId, origin, 'click', ref, undefined);
    return (await page(tabId, ctx, { beifahrer: 'click', ref })) as unknown as Result<'page.click'>;
  },

  /**
   * Keys, or text typed one character at a time.
   *
   * One of `key` and `text` has to be there: a call with neither presses nothing, and a call with
   * both has no defined order between "press this" and "type this". Refused here rather than
   * guessed, because a guessed order is a keystroke the person did not confirm.
   */
  async 'page.press'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const raw = params as unknown as Record<string, unknown>;
    const ref = raw.ref === undefined ? undefined : refOf(params);
    const key = raw.key;
    const text = raw.text;
    if (key !== undefined && typeof key !== 'string') return fail('invalid', 'key must be a string');
    if (text !== undefined && typeof text !== 'string') return fail('invalid', 'text must be a string');
    if (key === undefined && text === undefined)
      return fail('invalid', 'page.press needs a key ("Enter", "Tab", "Control+a") or text to type');
    if (key !== undefined && text !== undefined)
      return fail('invalid', 'page.press takes a key OR text, not both — call it twice if you mean both');
    if (typeof text === 'string' && text.length > MAX_TEXT)
      return fail('invalid', `text is longer than ${MAX_TEXT} characters`);
    const times = parseKeyTimes(raw.times);
    if (typeof times === 'string') return fail('invalid', times);
    // Parsed here as well as in the page, so a bad key is refused without a round trip and the
    // confirm window can name the key the person is agreeing to.
    if (key !== undefined) {
      const parsed = parseKeySpec(key);
      if (typeof parsed === 'string') return fail('invalid', parsed);
      // No separate check for a bare modifier here: `parseKeySpec` refuses one, and the reason it
      // gives is the right one. What this block must NOT do is decide that a key is "only a
      // modifier" because it types nothing — `Control+ArrowDown` types nothing either, and it is a
      // perfectly ordinary press that a listbox answers to.
    }
    const tab = await getTab(tabId);
    const { origin, confirm } = await gate('page.press', tab.url, policy, ctx);
    if (confirm) {
      // A press without a ref goes to the focused element, which the outline may not name at all —
      // so the window says where the keys are going, which is the fact the person needs.
      const where = ref
        ? String((await page(tabId, ctx, { beifahrer: 'describe', ref })).description ?? ref)
        : 'the focused element';
      // Typed text is shown as the text, and named as typing: "Press text: abc in Field" is a
      // sentence nobody would write, and the person has to read it to know what is about to happen.
      const answer = await askWrite(
        origin,
        'press',
        where,
        text !== undefined ? clipForWindow(text) : key,
        text !== undefined,
      );
      if (!answer.allow)
        fail('denied', `the person declined the press on ${origin} (or did not answer within two minutes)`);
      if (answer.remember) await rememberWrites(origin);
      await stillTheSameOrigin(tabId, origin, 'page.press');
    }
    return (await page(tabId, ctx, {
      beifahrer: 'press',
      ...(ref ? { ref } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(text !== undefined ? { text } : {}),
      times,
    })) as unknown as Result<'page.press'>;
  },

  async 'page.select'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    const values = params.values;
    if (!Array.isArray(values) || values.length === 0)
      return fail('invalid', 'values must be a non-empty array of option values or labels');
    if (values.length > 20) return fail('invalid', 'values has more than 20 entries');
    // An empty string is a legitimate option value — it is how a dropdown says "none of these" —
    // so it is not refused here. Only the length is bounded, because that is what the person reads
    // in the confirm window.
    if (!values.every((v) => typeof v === 'string' && v.length <= 200))
      return fail('invalid', 'every value must be a string of at most 200 characters');
    const add = params.add === true;
    const tab = await getTab(tabId);
    const { origin, confirm } = await gate('page.select', tab.url, policy, ctx);
    if (confirm) await confirmWrite(ctx, tabId, origin, 'select', ref, values.join(', '));
    return (await page(tabId, ctx, {
      beifahrer: 'select',
      ref,
      values,
      add,
    })) as unknown as Result<'page.select'>;
  },

  async 'page.check'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    if (params.checked !== undefined && typeof params.checked !== 'boolean')
      return fail('invalid', 'checked must be true or false');
    const checked = params.checked !== false;
    const tab = await getTab(tabId);
    const { origin, confirm } = await gate('page.check', tab.url, policy, ctx);
    if (confirm) await confirmWrite(ctx, tabId, origin, 'check', ref, String(checked));
    return (await page(tabId, ctx, { beifahrer: 'check', ref, checked })) as unknown as Result<'page.check'>;
  },

  async 'page.evaluate'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    // `tabId` and `browser` are the call's addressing and are stripped; every other key has to be
    // one the parser knows, so a key the agent invented is refused rather than dropped.
    const request = evaluateRequestOf(params);
    if (typeof request === 'string') return fail('invalid', request);
    // Stated rather than worked around: no WebExtension can run agent-supplied code in a page's own
    // world without injecting a <script> element — which the page's CSP blocks on most sites and
    // the page would see. The isolated world below covers "click that and tell me what happened".
    if (request.world !== 'isolated') {
      return fail(
        'unsupported',
        "beifahrer will not run a script in the page's own JavaScript world: doing so means injecting a " +
          '<script> element into the page, past its content security policy. Ask for what you need in the ' +
          "isolated world instead — the DOM is there, the page's JavaScript objects are not.",
      );
    }
    const tab = await getTab(tabId);
    // `confirm` is true here whatever the site's rule says: ALWAYS_CONFIRM (policy.ts) is what keeps
    // `confirmWrites: false` from reaching a method the level table does not describe.
    const { origin, confirm } = await gate('page.evaluate', tab.url, policy, ctx);
    if (confirm) await confirmScript(ctx, origin, request.script);
    // The window can sit there for two minutes, and in that time the tab can navigate and the
    // person can act. The person answered for the origin the window named, so that origin must
    // still be the one the script would run in — and the pause must not have been pressed.
    await stillTheSameOrigin(tabId, origin, 'page.evaluate');
    return (await page(tabId, ctx, {
      beifahrer: 'evaluate',
      script: request.script,
      maxChars: request.maxChars,
    })) as unknown as Result<'page.evaluate'>;
  },

  async 'tabs.open'(params, policy, ctx) {
    if (typeof params.url !== 'string') return fail('invalid', 'url must be a string');
    const decision = decide(policy, 'tabs.open', params.url, accessOf(ctx));
    // Below read the person may be asked, as for a page call; the browser's host grant is not
    // needed to open a tab, so an answer is enough.
    const answer =
      !decision.allow && decision.askable
        ? await askForAccess(
            { label: ctx.session, sessionId: ctx.sessionId },
            decision.origin!,
            decision.need,
          )
        : null;
    if (answer === 'once') ctx.settleAfter = true;
    if (!decision.allow && !answer) {
      return fail(
        'forbidden',
        `opening ${decision.origin ?? params.url} needs level "read" on that site; it is "${decision.have}". ` +
          (decision.askable
            ? 'Ask the person to allow the site first.'
            : 'The person blocked it or it is not a web page.'),
        { origin: decision.origin, have: decision.have, need: decision.need },
      );
    }
    const tab = await browser.tabs.create({ url: params.url, active: params.active !== false });
    const info = toTabInfo(
      { ...tab, url: tab.url || params.url },
      policy,
      await focusedWindowId(),
      accessOf(ctx),
    );
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
    // The temporary grants join the stored policy here, in the background that owns them.
    const withGrants: Policy = { ...policy, grants: await loadGrants() };
    try {
      return await handler((params ?? {}) as Params<Method>, withGrants, ctx);
    } finally {
      if (ctx.settleAfter) void settle();
    }
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
/**
 * A Manifest V2 content script has NO content security policy of its own, so it may compile a string
 * into a function. A Manifest V3 content script SHARES the extension's policy, and that policy
 * cannot be relaxed — Chrome refuses to install an extension whose `extension_pages` CSP names
 * `'unsafe-eval'`. So `page.evaluate` is not something a Manifest V3 build can ever serve
 * (ADR 0012, issue #31).
 *
 * The manifest version is the FILTER because it is available before the first page is opened, which
 * is what keeps `capabilities()` — and therefore `browsers_list` — honest for an agent that has not
 * called anything yet. It is deliberately not the last word: the page agent PROBES `new Function`
 * in the place the script would run and answers `unsupported` itself, because the background cannot
 * measure it (a Manifest V2 extension page forbids eval while a Manifest V2 content script does not).
 */
const NO_CODE_HERE =
  "a Manifest V3 content script shares the extension's content security policy, and that policy " +
  "cannot name 'unsafe-eval' — Chrome refuses to install an extension that tries. Firefox " +
  '(Manifest V2, no content-script CSP) can.';

/** A method this browser cannot serve, and the sentence it refuses with. */
interface Need {
  ok: () => boolean;
  why: () => string;
}

const NEEDS: Partial<Record<Method, Need>> = {
  'tabs.group': {
    ok: () => groupApi() !== null,
    why: () => 'this browser has no tab groups (MV3 chrome.tabs.group)',
  },
  'tabs.ungroup': {
    ok: () => groupApi() !== null,
    why: () => 'this browser has no tab groups (MV3 chrome.tabs.group)',
  },
  'sessions.recentlyClosed': {
    ok: () => sessionsApi() !== null,
    why: () => 'this browser has no sessions API',
  },
  'sessions.restoreClosed': {
    ok: () => sessionsApi() !== null,
    why: () => 'this browser has no sessions API',
  },
  'page.evaluate': {
    ok: () => browser.runtime.getManifest().manifest_version < 3,
    why: () => NO_CODE_HERE,
  },
};

export function capabilities(): Method[] {
  return (Object.keys(handlers) as Method[]).filter((m) => NEEDS[m]?.ok() ?? true);
}

/**
 * Why this browser cannot serve a method, per method (issue #31). Travels in the handshake, so an
 * agent reads "not allowed" and "cannot" apart before it spends a call — and the bridge quotes this
 * instead of a sentence that would fit one method and mislead about the next.
 */
export function unsupportedReasons(): Partial<Record<Method, string>> {
  const out: Partial<Record<Method, string>> = {};
  for (const [method, need] of Object.entries(NEEDS) as [Method, Need][])
    if (!need.ok()) out[method] = need.why();
  return out;
}
