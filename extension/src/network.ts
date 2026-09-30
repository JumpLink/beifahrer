/**
 * What the tabs of this browser requested, kept as a short tail per tab (issue #35).
 *
 * A page's console is not readable by an extension at all (AGENTS.md), so this is what an agent has
 * when a page did not do the thing: the POST that returned 500, the request a CSP or a CORS header
 * refused before it went out, the third-party script that never loaded. The browser's `webRequest`
 * sees exactly that much and nothing about the page's internals.
 *
 * Four things about how this is built, each of which cost something to get right:
 *
 * - **The listeners are registered at load, not when the person switches the feature on.** A
 *   `webRequest` listener added later is not reliably delivered — Chromium only guarantees events for
 *   listeners present when the request starts, and an MV3 service worker that sleeps and wakes must
 *   find them again. So the hook is unconditional and the RECORDING is the thing that is switched:
 *   one `features.network` check per event, off by default, costing nothing when it is off.
 * - **Without the permission there are no events at all**, and `browser.webRequest` may not even
 *   exist. So the listeners are attached only where the API is there, and the method answers why it
 *   is empty rather than pretending the page made no requests. The permission is `optional` and the
 *   person grants it (manifest.ts, options page) — a request log is a browsing history, and
 *   `webRequest` cannot be narrowed to one site, which is why the switch is off by default and why
 *   the person, not the agent, decides.
 * - **One buffer per tab, and the tab is the gate.** Rows are recorded for every tab (a request the
 *   tab did not make is not in its log), and `page.network` then asks the POLICY about the tab
 *   before reading it — the same order as every other page method, and the reason a blocked site has
 *   no network log to ask about.
 * - **The query never enters the buffer.** `redactUrl` runs where the row is built (core/network.ts),
 *   not where it is printed, because a row that kept the query anywhere would be one refactor away
 *   from handing over a `?token=`.
 */

import { browser } from '@wxt-dev/browser';
import { networkRow, type NetworkRow, type WebRequestFacts } from '@beifahrer/core';

import { framesOf } from './frames.ts';
import { loadSettings } from './settings.ts';

/** Per tab: the rows, oldest first, and the requests still open. */
interface TabLog {
  rows: NetworkRow[];
  /** Request id → the row it produced, so `onCompleted` can fill in the status. */
  open: Map<string, NetworkRow>;
  /** beifahrer's own frame numbers, keyed by the browser's, so a row can name its frame. */
  frames: Map<number, number>;
  at: number;
}

/** How long a tab's log survives without a request. A tab nobody browses should not be remembered. */
const LOG_TTL_MS = 10 * 60_000;

/** How many requests one tab's log holds. Enough to see a page load, not a browsing session. */
/** One entry per tab, and only for tabs that still have something in it. */
const logs = new Map<number, TabLog>();

function logFor(tabId: number, at: number): TabLog {
  const existing = logs.get(tabId);
  if (existing) {
    existing.at = at;
    return existing;
  }
  const fresh: TabLog = { rows: [], open: new Map(), frames: new Map(), at };
  logs.set(tabId, fresh);
  return fresh;
}

/** A tab's own frame numbers, so a row can say which document asked. 0 is the page. */
function frameIndex(tabId: number, pageUrl: string, browserFrameId: number): number {
  if (!browserFrameId) return 0;
  return framesOf(tabId, pageUrl).find((row) => row.frameId === browserFrameId)?.index ?? 0;
}

/** Drop the logs of tabs that have been quiet for a while, and those of tabs that are gone. */
function forget(tabId: number): void {
  logs.delete(tabId);
}

export function installNetworkCleanup(): void {
  browser.tabs.onRemoved.addListener((tabId: number) => forget(tabId));
}

/** The tab's log, or an empty one. Never throws: a tab that is gone has no log. */
export function rowsOf(tabId: number): { rows: NetworkRow[]; kept: number; truncated: boolean } {
  const now = Date.now();
  for (const [id, log] of logs) if (now - log.at > LOG_TTL_MS) logs.delete(id);
  const log = logs.get(tabId);
  if (!log) return { rows: [], kept: 0, truncated: false };
  // The cap is applied here as well as on insert, so a log that grew while the service worker slept
  // comes back as a tail rather than as a surprise.
  return {
    rows: log.rows.slice(-MAX_ROWS),
    kept: log.rows.length,
    truncated: log.rows.length > MAX_ROWS,
  };
}

const MAX_ROWS = 200;

/**
 * The `webRequest` surface, or null where the browser has none — which is also where the PERSON has
 * said no, because the API is only there once the optional permission is granted.
 *
 * Typed by what is used of it rather than by the whole API: the shim's own types name every event and
 * every field of a request, and this file needs three events and a handful of fields, so a local
 * shape is both smaller and the thing a future API change shows up in.
 */
interface WebRequestApi {
  onBeforeRequest: { addListener(fn: (details: Record<string, unknown>) => void, filter: unknown): void };
  onCompleted: { addListener(fn: (details: Record<string, unknown>) => void, filter: unknown): void };
  onErrorOccurred: { addListener(fn: (details: Record<string, unknown>) => void, filter: unknown): void };
}

function webrequest(): WebRequestApi | null {
  const api = (browser as unknown as { webRequest?: Partial<WebRequestApi> }).webRequest;
  return api && api.onBeforeRequest && api.onCompleted && api.onErrorOccurred ? (api as WebRequestApi) : null;
}

/** Is the person watching? Cached for a moment, because this runs per request event. */
let watching: { on: boolean; at: number } = { on: false, at: 0 };
async function isWatching(): Promise<boolean> {
  const now = Date.now();
  if (now - watching.at < 1_000) return watching.on;
  const { features } = await loadSettings();
  watching = { on: features.network === true, at: now };
  return watching.on;
}

function factsOf(details: Record<string, unknown>): WebRequestFacts {
  return {
    requestId: String(details.requestId ?? ''),
    ...(typeof details.tabId === 'number' ? { tabId: details.tabId } : {}),
    ...(typeof details.frameId === 'number' ? { frameId: details.frameId } : {}),
    ...(typeof details.method === 'string' ? { method: details.method } : {}),
    ...(typeof details.url === 'string' ? { url: details.url } : {}),
    ...(typeof details.statusCode === 'number' ? { statusCode: details.statusCode } : {}),
    ...(typeof details.error === 'string' ? { error: details.error } : {}),
    ...(typeof details.type === 'string' ? { type: details.type } : {}),
    at: Date.now(),
  };
}

/** A request that is on its way out: recorded as pending, and completed or failed later. */
async function started(details: Record<string, unknown>): Promise<void> {
  if (!(await isWatching())) return;
  const facts = factsOf(details);
  // No tab id means the browser's own request (an update check, a captive-portal probe). It is not
  // a page's request and there is no tab to gate it on, so it is not recorded.
  if (facts.tabId === undefined) return;
  // The tab is only asked about for a FRAME: the frame table is keyed by the tab's URL, and the
  // page's own requests are frame 0 whatever the URL is. A `tabs.get` per request on a busy tab is
  // a cost the feature should not pay for a number it already knows.
  const frame =
    facts.frameId && facts.frameId !== 0
      ? frameIndex(
          facts.tabId,
          String((await browser.tabs.get(facts.tabId).catch(() => null))?.url ?? ''),
          facts.frameId,
        )
      : 0;
  const row = networkRow(facts, frame, true);
  if (!row) return;
  const log = logFor(facts.tabId, facts.at);
  log.rows.push(row);
  log.open.set(facts.requestId, row);
  if (log.rows.length > MAX_ROWS) log.rows = log.rows.slice(-MAX_ROWS);
}

/** A request that finished: the same row, with the status, or with the browser's own error. */
async function ended(details: Record<string, unknown>, failed: boolean): Promise<void> {
  if (!(await isWatching())) return;
  const tabId = details.tabId;
  if (typeof tabId !== 'number') return;
  const log = logs.get(tabId);
  const row = log?.open.get(String(details.requestId ?? ''));
  if (!row) return;
  log?.open.delete(String(details.requestId ?? ''));
  row.pending = false;
  // `net::ERR_*` is the browser's own word for what went wrong, and it is the whole point: a CSP or a
  // CORS header that refused the request never produces a status to report. A completion without a
  // status is not invented into one — the row simply stays as it was, which is the truth about it.
  if (failed) {
    if (typeof details.error === 'string') row.error = details.error;
  } else if (typeof details.statusCode === 'number') row.status = details.statusCode;
}

/**
 * Attach the listeners. Called once, at load, and safe to call where the API is missing: a browser
 * without `webRequest` (or without the grant) has no events to attach to, and `page.network` answers
 * why the log is empty instead of failing here where nobody asked anything yet.
 */
export function installNetworkWatch(): void {
  const api = webrequest();
  if (!api) return;
  // `urls` is deliberately unfiltered: a third-party script is half of what "the page did not work"
  // means, and filtering to the tab's own origin would hide exactly the request an agent is looking
  // for. What may be REPORTED is decided per tab, by the policy, in the method.
  api.onBeforeRequest.addListener((details) => void started(details), {
    urls: ['http://*/*', 'https://*/*'],
  });
  api.onCompleted.addListener((details) => void ended(details, false), {
    urls: ['http://*/*', 'https://*/*'],
  });
  api.onErrorOccurred.addListener((details) => void ended(details, true), {
    urls: ['http://*/*', 'https://*/*'],
  });
}

/** Is the browser even able to answer? The method says this in words rather than returning nothing. */
export function networkAvailable(): boolean {
  return webrequest() !== null;
}
