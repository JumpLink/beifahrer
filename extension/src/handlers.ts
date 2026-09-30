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
  levelFor,
  parseElementQuery,
  parseKeySpec,
  parseKeyTimes,
  parseNavigate,
  parseMetaQuery,
  parseRef,
  namespaceRefs,
  scriptPreview,
  type ElementQuery,
  type FoundElement,
  type Navigation,
  type ParsedRef,
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
import { correctFrame, frameByIndex, framesOf, isWebUrl, type FrameRow } from './frames.ts';
import { loadGrants, settle } from './grants.ts';
import { askPage, inject } from './inject.ts';
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

/**
 * The ref the caller named, checked but not yet resolved to a frame.
 *
 * `b2e12` is a ref inside a frame: each frame runs its own page agent with its own registry, so
 * `e12` exists once per frame and those are different elements. The frame is part of the ref rather
 * than a second parameter, because an ambiguous ref in a WRITE is a click on the wrong element — in
 * a frame on another origin, a write in the name of a site the person never allowed.
 */
function refOf(params: unknown): string {
  const ref = (params as { ref?: unknown } | null)?.ref;
  const parsed = parseRef(ref);
  if (typeof parsed === 'string') return fail('invalid', parsed);
  return ref as string;
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

/**
 * Ask ONE frame and return its data.
 *
 * `frame` 0 is the page's own document. Above that it is a frame the person has ALLOWED at this
 * method's level — the caller gates it, because only the caller knows the method and its level, and
 * a check in here would have to guess which method it is serving.
 *
 * Every answer comes back in the frame's namespace: the agent inside a frame hands out bare `e12`,
 * and the agent on the other side of the bridge must not be able to tell that from a ref in the
 * page's own document. That is done on the serialized text rather than on the parsed object, so it
 * covers the ref, a ref inside a `description`, and anything else the page's answer carries.
 */
async function page(
  tabId: number,
  ctx: CallContext,
  req: PageRequest,
  /** The BROWSER's frame number to send to. 0 is the top document. */
  frame = 0,
  /**
   * beifahrer's frame number, which is what its refs are namespaced with.
   *
   * Two numbers, because they are not the same thing: Firefox numbers a frame `10737418241` and a
   * ref is something an agent reads, so the send uses the browser's id and the NAME uses ours.
   * Defaulting to `frame` is what kept this from being visible: the top document is 0 in both, so
   * every call without a frame looked right while a frame's refs came out named after an internal
   * counter — which is a ref the agent cannot use and `parseRef` correctly refuses.
   */
  refFrame = frame,
): Promise<Record<string, unknown>> {
  // The session names itself on the in-page pill.
  const ask = ctx.session ? { ...req, session: ctx.session } : req;
  const res = await askPage(tabId, ask, frame).catch((err: Error) =>
    fail('failed', `could not reach the page: ${err.message}`),
  );
  if (!res)
    return fail('not_found', frame === 0 ? 'the page did not answer' : `frame ${frame} did not answer`);
  if (!res.ok) return fail(res.code, res.message);
  if (refFrame === 0) return res.data;
  return namespace(res.data, refFrame);
}

/** Put a frame's answer into the agent's namespace, wherever its refs appear. */
function namespace(data: Record<string, unknown>, frame: number): Record<string, unknown> {
  return JSON.parse(namespaceRefs(JSON.stringify(data), frame)) as Record<string, unknown>;
}

/**
 * Which frames of a tab the person has allowed for what is about to happen, and which of those
 * actually answer.
 *
 * The gate is per ORIGIN and per level, exactly as it is for a tab: a frame on a site below `read`
 * is not asked at all, so a page that embeds somebody else's widget does not hand the agent that
 * widget — the same boundary that stopped `all_frames` from being a bypass, now applied deliberately
 * instead of by accident.
 */
/**
 * Ask every known frame where it is, and take its answer as the truth about its origin.
 *
 * Two things are deliberately in this order (issue #32). DISCOVERY comes from the frame announcing
 * itself, because only the browser knows which frames exist. The URL then comes from the frame
 * ITSELF, asked again here, because a frame that is still loading answers `about:blank` and one that
 * navigated answers something else than it did at injection time — and the policy is decided on the
 * URL, so a cached one would gate a frame on an origin it no longer has.
 *
 * Asking before gating sounds backwards, so it is worth being exact about it: the `where` request
 * returns the frame's OWN `location.href` and nothing else. The extension chose where it injected, so
 * it knows this already, no page content crosses the boundary, and the person is asked about
 * something only afterwards. The alternative — gate on the announcement's URL — is a gate that can be
 * wrong, and a gate that can be wrong about an origin is not a gate.
 */
async function locateFrames(tabId: number, pageUrl: string): Promise<FrameRow[]> {
  const out: FrameRow[] = [];
  for (const row of framesOf(tabId, pageUrl)) {
    const url = (await askWhere(tabId, row.frameId)) ?? row.url;
    correctFrame(tabId, row.frameId, url);
    out.push({ ...row, url });
  }
  return out;
}

/** The frames whose OWN origin the person allows at this level. A frame below `read` is not asked. */
function framesAtLevel(rows: FrameRow[], policy: Policy, ctx: CallContext, level: Level): FrameRow[] {
  // `levelFor`, NOT `decide(...).have`. `Decision` is a union, and the two branches carry DIFFERENT
  // fields: the allowed one has `allow` and `confirm` and nothing else, the refused one has `origin`,
  // `have` and `need`. Reading `have` off a decision that allowed is therefore not a wrong value but
  // NO value — and `atLeast(undefined, 'read')` is false, so every allowed frame was dropped while
  // the code read as though it were asking the policy. It is also why this is asked through
  // `levelFor`: the level of an origin is a question with an answer in both cases, where the union
  // only answers it when the answer is "no".
  return rows.filter((row) => atLeast(levelFor(policy, row.url, accessOf(ctx)), level));
}

/** The heading that separates one document from the next, in a read and in an outline alike. */
const FRAME_MARK = '— frame: ';

/**
 * Ask every frame the person allows, and what each of them answers.
 *
 * The top document is asked first and always: it is the page the person is looking at, and if it
 * cannot be reached the call is a failure rather than a shorter answer. Each frame after it is
 * asked on its own and contributes a section — and a frame that does not answer is skipped, not
 * failed on, because a frame that was torn down between the announcement and this call is a normal
 * event on a page with adverts on it.
 *
 * `text` and `outline` come back as the page's own text with each frame's text under its URL, which
 * is the arrangement of the page: two frames side by side produce two texts that are visually
 * adjacent and not one text, so running them together would invent an order the page never had.
 */
async function readAcrossFrames(
  tabId: number,
  ctx: CallContext,
  req: PageRequest,
  policy: Policy,
  level: Level,
): Promise<{ frame: number; data: Record<string, unknown> }[]> {
  const top = await page(tabId, ctx, req);
  // The frames have to be INJECTED INTO before anything can be asked of them: a frame announces
  // itself when its agent appears, and the agent appears when the extension injects. A frame the
  // browser has no host permission for is skipped silently here — measured — which is the FIRST
  // boundary, ahead of the policy: a frame on an origin beifahrer cannot even inject into is not
  // merely unreadable, it has no code in it at all.
  //
  // And if that injection is REFUSED outright, the reason travels into the answer instead of being
  // swallowed: an agent that sees a page full of embeds and is told nothing cannot tell "this page
  // embeds nothing" from "beifahrer could not look inside", and those two need different next moves.
  const injection = await inject(tabId, true).then(
    () => null,
    (err: Error) => `frames could not be reached in this browser: ${err.message}`,
  );
  // Wait for a URL, not for a row. The row arrives with the first injection; the URL arrives when the
  // frame's own document commits, and a frame that is still loading has no origin to ask a policy
  // about. The count of frames the page reports is what "arrived" means, so the wait is derived
  // rather than guessed — a sleep would be too short for a page with thirty embeds and needlessly
  // long for a page with none.
  const expected = Number(top.frames ?? 0);
  let rows: FrameRow[] = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    rows = await locateFrames(tabId, String(top.url ?? ''));
    if (rows.filter((row) => isWebUrl(row.url)).length >= expected) break;
    await sleep(25);
  }
  const out: { frame: number; data: Record<string, unknown> }[] = [
    { frame: 0, data: injection ? { ...top, framesUnavailable: injection } : top },
  ];
  for (const row of framesAtLevel(rows, policy, ctx, level)) {
    // A frame that does not answer is not silently dropped. It is a frame the person's policy ALLOWS
    // and the answer then leaves out, and an agent cannot tell that from a page that embeds nothing
    // — those two need different next moves. The reason travels with the answer instead.
    // `row.frameId` to REACH the frame, `row.index` to NAME it. They are different numbers on
    // purpose — Firefox numbers a frame 10737418241, and a ref is something an agent reads.
    const answer = await page(tabId, ctx, req, row.frameId, row.index).then(
      (data) => ({ data }),
      (err: Error) => ({ err: err.message }),
    );
    // The origin is checked AGAIN, against the one the policy was applied to — not because the first
    // check was wrong, but because between it and this read the frame may have navigated, and a
    // frame that is at a blocked origin now is a frame whose content must not reach the agent. A
    // check and a read are two messages, so there is a window; the answer carries the frame's own
    // `location.href` from the SAME message as its content, which makes that window as small as the
    // platform allows rather than open-ended. The write path has no window at all: `routeFor` asks
    // where the frame is and gates in one step, and the write itself is the next message.
    const said = 'data' in answer ? originOf(String(answer.data.url ?? '')) : null;
    const moved =
      said !== null && said !== originOf(row.url) ? `it moved to ${said} while it was being read` : null;
    out.push(
      'data' in answer && !moved
        ? { frame: row.index, data: answer.data }
        : { frame: row.index, data: { unreadable: moved ?? ('err' in answer ? answer.err : 'unknown') } },
    );
  }
  return out;
}

/** The frames' text under their URLs, for a read. */
function joinedText(parts: { frame: number; data: Record<string, unknown> }[], top: string): string {
  const head = String(parts[0]?.data.text ?? top);
  const rest = parts
    .slice(1)
    .map((part) =>
      part.data.unreadable
        ? `${FRAME_MARK}${part.data.url ?? 'a frame'}\n— not readable: ${part.data.unreadable}`
        : `${FRAME_MARK}${part.data.url ?? ''}\n${String(part.data.text ?? '').trim()}`,
    )
    .filter((section) => section.trim() !== FRAME_MARK);
  return [head, ...rest].filter(Boolean).join('\n\n').trim();
}

/** The frames' outlines under their URLs, for an outline. */
function joinedOutline(parts: { frame: number; data: Record<string, unknown> }[], top: string): string {
  const head = String(parts[0]?.data.outline ?? top);
  const rest = parts
    .slice(1)
    .map((part) =>
      part.data.unreadable
        ? `${FRAME_MARK}${part.data.url ?? 'a frame'}\n— not readable: ${part.data.unreadable}`
        : `${FRAME_MARK}${part.data.url ?? ''}\n${String(part.data.outline ?? '').trim()}`,
    )
    .filter((section) => section.trim() !== FRAME_MARK);
  return [head, ...rest].filter(Boolean).join('\n');
}

/**
 * Which document a ref points into, that document's OWN origin, and whether the person must confirm.
 *
 * This is the centre of issue #32 and the reason the frame is in the ref. A frame on another origin
 * is a different site: the page's level does not carry into it, so the policy is asked about the
 * FRAME's URL, and the confirmation window shows the FRAME's origin — the origin in which the write
 * happens, which is the whole point of asking. A page that embeds a comment widget therefore cannot
 * have the widget written to through the page's permission, and that is deliberate: granting the
 * page does not grant the things inside it.
 */
async function routeFor(
  method: Method,
  tabId: number,
  ref: string,
  policy: Policy,
  ctx: CallContext,
): Promise<{ frame: number; index: number; ref: string; origin: string; confirm: boolean }> {
  const parsed = parseRef(ref) as ParsedRef;
  if (parsed.frame === 0) return routeForTop(method, tabId, policy, ctx, parsed.local);
  // The ref names beifahrer's frame number; the browser's own number is looked up behind it and never
  // reaches the wire in a ref. (frames.ts: Firefox numbers a frame 10737418241, so a ref built from
  // the browser's id is neither short nor comparable — and the agent is the one reading it.)
  const here = (await getTab(tabId)).url ?? '';
  const found = frameByIndex(tabId, parsed.frame, here);
  if (!found) {
    // What IS there, because "gone" alone sends an agent looking in the page. The usual reasons are
    // all worth naming in one line: the page changed since the ref was given, the frame was torn
    // down, or the frame is on an origin below Read and was never asked.
    const known = framesOf(tabId, here);
    fail(
      'not_found',
      `frame b${parsed.frame} is not part of this page's frame set (${known.length} frame${known.length === 1 ? '' : 's'}: ${
        known.map((r) => `b${r.index}`).join(', ') || 'none readable'
      }). Call page_outline again for a ref in a frame.`,
    );
  }
  const row: FrameRow = found;
  // Ask the frame where it is NOW, not what it said when it was injected. A write is the one thing
  // that must never be gated on a remembered origin: a frame that navigated from a site the person
  // allowed to one they did not would otherwise be written to under the OLD site's permission, and
  // the confirmation window would name the old site too.
  const url = (await askWhere(tabId, row.frameId)) ?? row.url;
  correctFrame(tabId, row.frameId, url);
  const { origin, confirm } = await gate(method, url, policy, ctx);
  return { frame: row.frameId, index: row.index, ref: parsed.local, origin, confirm };
}

/** The top document as a route: the same shape, so a refless call reads like a ref'd one. */
async function routeForTop(
  method: Method,
  tabId: number,
  policy: Policy,
  ctx: CallContext,
  local = '',
): Promise<{ frame: number; index: number; ref: string; origin: string; confirm: boolean }> {
  const tab = await getTab(tabId);
  const { origin, confirm } = await gate(method, tab.url, policy, ctx);
  return { frame: 0, index: 0, ref: local, origin, confirm };
}

/** A frame's own `location.href`, or null when it does not answer. Never throws. */
async function askWhere(tabId: number, frame: number): Promise<string | null> {
  const answer = await askPage(tabId, { beifahrer: 'where' }, frame).catch(() => undefined);
  if (!answer?.ok) return null;
  const url = answer.data.url;
  return typeof url === 'string' && url !== '' ? url : null;
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
 *
 * For a tab that is ALREADY loading, which is the only caller (`page.wait`): a tab counts as loaded
 * from the moment its last load ended until one begins, so this cannot tell "loaded" from "has not
 * started yet". `waitForNavigation` below exists for exactly that difference and says why.
 */
async function waitForLoad(tabId: number, deadline: number): Promise<void> {
  for (;;) {
    const tab = await getTab(tabId);
    if (tab.status === 'complete') return;
    if (Date.now() >= deadline) fail('timeout', `tab ${tabId} did not finish loading in time`);
    await sleep(200);
  }
}

/**
 * Wait for the load that a navigation we JUST asked for produces — not merely for a loaded tab.
 *
 * The distinction is not academic. A tab reports `complete` from the moment its last load finished
 * until it starts loading again, so a plain `waitForLoad` right after `tabs.goBack` returns
 * immediately: the browser has been told to go back and has not done it yet. Measured — `back`
 * answered `ok`, and the next `page_read` still showed the page we had come FROM. So this watches
 * for the transition as well as the end state: a `loading` event, or a URL that is no longer the one
 * the tab had. A reload changes no URL, which is exactly why the event is not optional.
 *
 * And a browser that fires no `tabs.onUpdated` at all (Epiphany, issue #2) can never set that flag,
 * so a grace period accepts the old page afterwards: by then a load that was going to start has.
 */
async function waitForNavigation(
  tabId: number,
  was: string | undefined,
  started: number,
  deadline: number,
): Promise<boolean> {
  let loading = false;
  const onUpdated = (id: number, change: { status?: string }) => {
    if (id === tabId && change.status === 'loading') loading = true;
  };
  browser.tabs.onUpdated.addListener(onUpdated);
  try {
    for (;;) {
      const tab = await getTab(tabId);
      const now = Date.now();
      if (tab.status === 'complete' && (tab.url !== was || loading)) return true;
      // A browser that fires no `tabs.onUpdated` at all (Epiphany, issue #2) can never set that flag,
      // so a grace period accepts the old page afterwards: by then a load that was going to start
      // has. It reports FALSE, because without the event there is nothing that says the tab moved,
      // and saying so is the caller's business rather than this function's guess.
      if (tab.status === 'complete' && now - started > 2_000) return false;
      if (now >= deadline) fail('timeout', `tab ${tabId} did not finish loading in time`);
      await sleep(150);
    }
  } finally {
    browser.tabs.onUpdated.removeListener(onUpdated);
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
    // A frame on an origin the person allows is part of the page the person is reading, so it is
    // part of its text. A frame they did not allow is not asked at all (issue #32).
    const parts = await readAcrossFrames(tabId, ctx, { beifahrer: 'read', maxChars }, policy, 'read');
    const head = parts[0].data;
    const text = joinedText(parts, '');
    return {
      url: String(head.url ?? tab.url ?? ''),
      title: String(head.title ?? ''),
      text,
      truncated: text.length > maxChars || parts.slice(1).some((p) => p.data.truncated === true),
    } as Result<'page.read'>;
  },

  async 'page.download'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.download', tab.url, policy, ctx);
    const raw = params as unknown as Record<string, unknown>;
    const ref = typeof raw.ref === 'string' ? refOf(params) : undefined;
    const url = typeof raw.url === 'string' ? raw.url : undefined;
    // 10 MB covers a scanned letter or a statement; the ceiling keeps one document from filling
    // the bridge. The page checks it again against the bytes it actually got.
    const maxBytes = Math.min(Math.max(Number(raw.maxBytes) || 10_000_000, 1_000), 25_000_000);
    // A link inside a frame is fetched by that frame, in the tab's session and against the FRAME's
    // origin — a document reached from another site must not be pulled through the page's grant.
    const route = ref
      ? await routeFor('page.download', tabId, ref, policy, ctx)
      : { frame: 0, index: 0, ref: undefined as string | undefined, origin: '', confirm: false };
    return (await page(
      tabId,
      ctx,
      { beifahrer: 'download', ref: route.ref, url, maxBytes },
      route.frame,
      route.index,
    )) as unknown as Result<'page.download'>;
  },

  async 'page.outline'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const tab = await getTab(tabId);
    await gate('page.outline', tab.url, policy, ctx);
    const maxItems = Math.min(Math.max(Number(params.maxItems) || 400, 10), 2_000);
    // Per frame, not shared: `maxItems` is a bound on the ANSWER, and spending it on the top document
    // would leave a frame with no lines at all. Each frame gets the whole budget and the caller is
    // told the answer was cut.
    const parts = await readAcrossFrames(tabId, ctx, { beifahrer: 'outline', maxItems }, policy, 'read');
    const head = parts[0].data;
    const unavailable = parts[0].data.framesUnavailable;
    const outline = joinedOutline(parts, '') + (unavailable ? `\n— ${unavailable}` : '');
    return {
      url: String(head.url ?? tab.url ?? ''),
      title: String(head.title ?? ''),
      outline,
      count: outline.split('\n').filter((line) => line.trim()).length,
      truncated: parts.length > 1 || parts[0].data.truncated === true,
    } as Result<'page.outline'>;
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
    // `nth` is counted HERE, across the documents in the order the outline shows them, and every
    // frame is asked WITHOUT it. Left inside the frame it would mean "the third match in that
    // frame", and a recipe asking for "the second Save button" would then get a different element
    // depending on which document it happened to be in — the kind of drift a recipe cannot see.
    const nth = query.nth;
    const frames = await readAcrossFrames(
      tabId,
      ctx,
      {
        beifahrer: 'find',
        query: { ...query, ...(nth === undefined ? {} : { nth: undefined }) },
        maxResults,
      },
      policy,
      'read',
    );
    const matches = frames.flatMap((part) => (part.data.matches as FoundElement[] | undefined) ?? []);
    const wanted = nth === undefined ? matches : nth < matches.length ? [matches[nth]!] : [];
    return {
      url: String(frames[0].data.url ?? tab.url ?? ''),
      matches: wanted.slice(0, maxResults),
      count: wanted.length,
      truncated: wanted.length > maxResults,
    } as Result<'page.find'>;
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
    // Asked of every allowed frame AT THE SAME TIME, and the first document with a match wins. A
    // frame in which it never appears must not hold the others up, so this is a race and not a
    // sequence — a comment box that opens inside an embedded widget is the case that needs it.
    const attempts = [
      page(tabId, ctx, { beifahrer: 'wait', query, timeoutMs: left }),
      ...framesAtLevel(await locateFrames(tabId, (await getTab(tabId)).url ?? ''), policy, ctx, 'read').map(
        (row) =>
          // `row.index` again: a `wait` that found the element answers with its ref, and a ref from a
          // frame is only usable if it names the frame.
          page(tabId, ctx, { beifahrer: 'wait', query, timeoutMs: left }, row.frameId, row.index).catch(
            () => ({}) as Record<string, unknown>,
          ),
      ),
    ];
    const answers = await Promise.race([
      Promise.all(attempts).then((all) => all.find((a) => a.match)),
      // Nothing anywhere: after the timeout the slowest one answers, and its own message is the one
      // the agent gets — a frame's wording about what it waited for, or the top document's.
      sleep(left).then(() => null),
    ]);
    const data = answers ?? (await Promise.all(attempts)).find((a) => a.match) ?? {};
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
    // The origin in the gate is the DOCUMENT's: for a ref inside a frame that is the frame's own
    // site, and the confirm window shows it (issue #32).
    const route = await routeFor('page.fill', tabId, ref, policy, ctx);
    if (route.confirm) await confirmWrite(ctx, tabId, route.origin, 'fill', route.ref, params.text);
    return (await page(
      tabId,
      ctx,
      { beifahrer: 'fill', ref: route.ref, text: params.text, as, mode },
      route.frame,
      route.index,
    )) as unknown as Result<'page.fill'>;
  },

  async 'page.click'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    const route = await routeFor('page.click', tabId, ref, policy, ctx);
    if (route.confirm) await confirmWrite(ctx, tabId, route.origin, 'click', route.ref, undefined);
    return (await page(
      tabId,
      ctx,
      { beifahrer: 'click', ref: route.ref },
      route.frame,
      route.index,
    )) as unknown as Result<'page.click'>;
  },

  /**
   * Keys, or text typed one character at a time.
   *
   * One of `key` and `text` has to be there: a call with neither presses nothing, and a call with
   * both has no defined order between "press this" and "type this". Refused here rather than
   * guessed, because a guessed order is a keystroke the person did not confirm.
   */
  /**
   * Move the person's own tab.
   *
   * Checked in the order that matters here, and the middle step is the one that is easy to forget:
   * the ORIGIN THE TAB IS ON has to be allowed (that is the page in front of the person, and for a
   * history move it is the only origin there is to ask about), and a URL THE AGENT SUPPLIES needs
   * `read` on its own target, exactly like `tabs.open`. Without the second, an agent that had just
   * read a page could carry it away in the query string of a site nobody ever allowed.
   *
   * Going back or forward cannot be checked that way — no browser API will say where a history
   * entry points — so the bound is what the person can see: the tab, as it is now. Where it LANDS
   * is then asked again, and a destination below `read` is refused with its origin. The tab has
   * moved by then; the answer exists so the agent stops instead of reading a blocked page, which is
   * the whole reason the level table is checked twice here.
   */
  async 'page.navigate'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const { tabId: _t, browser: _b, ...rest } = params as unknown as Record<string, unknown>;
    const req = parseNavigate(rest);
    if (typeof req === 'string') return fail('invalid', req);
    const tab = await getTab(tabId);
    await gate('page.navigate', tab.url, policy, ctx);
    if (req.navigation === 'url' && req.url) {
      const decision = decide(policy, 'page.navigate', req.url, accessOf(ctx));
      if (!decision.allow) {
        const answer =
          decision.askable &&
          (await askForAccess(
            { label: ctx.session, sessionId: ctx.sessionId },
            decision.origin!,
            decision.need,
          )) === 'once'
            ? 'once'
            : null;
        if (answer === 'once') ctx.settleAfter = true;
        if (!decision.allow && !answer) {
          return fail(
            'forbidden',
            `navigating to ${decision.origin ?? req.url} needs level "read" on that site; it is "${decision.have}". ` +
              (decision.askable
                ? 'Ask the person to allow the site first.'
                : 'The person blocked it or it is not a web page.'),
            { origin: decision.origin, have: decision.have, need: decision.need },
          );
        }
      }
    }

    const started = Date.now();
    const deadline = started + req.timeoutMs;
    try {
      if (req.navigation === 'url') await browser.tabs.update(tabId, { url: req.url });
      else if (req.navigation === 'back') await browser.tabs.goBack(tabId);
      else if (req.navigation === 'forward') await browser.tabs.goForward(tabId);
      else await browser.tabs.reload(tabId);
    } catch (err) {
      // For a history move, the browser REFUSING is an answer, not a failure: Chromium rejects
      // `goBack` with "Cannot find a next page in history" when there is no entry, which is the
      // normal state of a tab the person opened at a URL. It is reported as `moved: false` WITH the
      // browser's own words, because swallowing it once taught the wrong lesson: an earlier version
      // caught it and answered `ok`, and an agent then read the page it believed it had left.
      // A url or a reload that is refused IS a failure, and says so.
      if (req.navigation === 'back' || req.navigation === 'forward') {
        return {
          url: tab.url ?? null,
          title: tab.title ?? '',
          navigation: req.navigation as Navigation,
          moved: false,
          reason: (err as Error).message,
          waitedMs: 0,
        };
      }
      return fail('failed', `the browser refused to move the tab: ${(err as Error).message}`);
    }
    // The load is waited for, because a `page_read` right after a goto would otherwise read the
    // document that is on its way out — the same reason `page.wait` waits. `waitForNavigation` and
    // not `waitForLoad`: a tab counts as loaded until it starts loading again, so the plain one
    // would return before `goBack` had even happened.
    const moved = await waitForNavigation(tabId, tab.url, started, deadline);
    const loaded = await getTab(tabId);
    const after = decide(policy, 'page.navigate', loaded.url, accessOf(ctx));
    if (!after.allow) {
      return fail(
        'forbidden',
        `the tab is now on ${after.origin ?? 'another page'}, which is at level "${after.have}" in beifahrer. ` +
          'The move already happened; nothing on that page may be read, and beifahrer will not name ' +
          'its path for you.',
        { origin: after.origin, have: after.have, need: after.need },
      );
    }
    return {
      url: loaded.url ?? null,
      title: loaded.title ?? '',
      navigation: req.navigation as Navigation,
      moved,
      waitedMs: moved ? Date.now() - started : 0,
    };
  },

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
    // A ref in a frame is routed like every other write, or a `b2e12` would press a key in the TOP
    // document — the one place where a ref that names a frame must never be quietly ignored, because
    // the person confirmed one site and the keys would go to another.
    //
    // Without a ref the keys go wherever the FOCUSED element is, which in a frame is inside that
    // frame — and no agent can tell which, so a refless press is the top document's. Guessing the
    // frame would put keys into a document nobody chose.
    const route = ref
      ? await routeFor('page.press', tabId, ref, policy, ctx)
      : await routeForTop('page.press', tabId, policy, ctx);
    const { origin, confirm } = route;
    if (confirm) {
      // A press without a ref goes to the focused element, which the outline may not name at all —
      // so the window says where the keys are going, which is the fact the person needs.
      const where = ref
        ? String(
            (await page(tabId, ctx, { beifahrer: 'describe', ref: route.ref }, route.frame, route.index))
              .description ?? route.ref,
          )
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
    return (await page(
      tabId,
      ctx,
      {
        beifahrer: 'press',
        ...(ref ? { ref: route.ref } : {}),
        ...(key !== undefined ? { key } : {}),
        ...(text !== undefined ? { text } : {}),
        times,
      },
      route.frame,
      route.index,
    )) as unknown as Result<'page.press'>;
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
    const route = await routeFor('page.select', tabId, ref, policy, ctx);
    if (route.confirm) await confirmWrite(ctx, tabId, route.origin, 'select', route.ref, values.join(', '));
    return (await page(
      tabId,
      ctx,
      { beifahrer: 'select', ref: route.ref, values, add },
      route.frame,
      route.index,
    )) as unknown as Result<'page.select'>;
  },

  async 'page.check'(params, policy, ctx) {
    const tabId = tabIdOf(params);
    const ref = refOf(params);
    if (params.checked !== undefined && typeof params.checked !== 'boolean')
      return fail('invalid', 'checked must be true or false');
    const checked = params.checked !== false;
    const route = await routeFor('page.check', tabId, ref, policy, ctx);
    if (route.confirm) await confirmWrite(ctx, tabId, route.origin, 'check', route.ref, String(checked));
    return (await page(
      tabId,
      ctx,
      { beifahrer: 'check', ref: route.ref, checked },
      route.frame,
      route.index,
    )) as unknown as Result<'page.check'>;
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
