/**
 * The scripts each tab loaded, workers included, and their text on demand (issue #234).
 *
 * The list comes from `webRequest` (`script`, plus `.js` files fetched by script or worker), so it
 * also sees what a worker imported, which `performance` in the page does not. It rides on the
 * request-log switch (`features.network`) and its optional `webRequest` grant: one permission, one
 * decision by the person.
 *
 * The text is fetched by the extension WITHOUT cookies (`credentials: 'omit'`) and cached per tab and
 * URL. A script that serves something else to a signed-in session therefore stays what an anonymous
 * visitor gets, and no page state or storage is read. A cross-origin script the browser refuses to
 * hand over is listed with the reason instead of being skipped silently.
 */

import { browser } from '@wxt-dev/browser';
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_CACHE_BYTES,
  MAX_SOURCE_SCRIPTS,
  PRIVATE_NETWORK_ERROR,
  SOURCE_SEARCH_BUDGET_MS,
  matchesFilter,
  mayFetchScript,
  searchText,
  sourceKind,
  sourceMapOf,
  sourceUrl,
  type SourceHit,
  type SourceKind,
  type SourceRow,
} from '@beifahrer/core';

import { isWatching } from './network.ts';

interface Script {
  /** The full URL, including the query: the fetch needs it, the agent never sees it. */
  full: string;
  kind: SourceKind;
  text?: string;
  error?: string;
}

interface TabScripts {
  tabId: number;
  /** Keyed by the URL without query, so the agent's `url` argument finds it. */
  byUrl: Map<string, Script>;
  at: number;
}

const LOG_TTL_MS = 10 * 60_000;
const tabs = new Map<number, TabScripts>();

function forget(tabId: number): void {
  tabs.delete(tabId);
}

function scriptsOf(tabId: number): TabScripts {
  const now = Date.now();
  for (const [id, t] of tabs) if (now - t.at > LOG_TTL_MS) tabs.delete(id);
  const existing = tabs.get(tabId);
  if (existing) {
    existing.at = now;
    return existing;
  }
  const fresh: TabScripts = { tabId, byUrl: new Map(), at: now };
  tabs.set(tabId, fresh);
  return fresh;
}

async function seen(details: Record<string, unknown>): Promise<void> {
  const tabId = details.tabId;
  if (typeof tabId !== 'number' || tabId < 0) return;
  const full = typeof details.url === 'string' ? details.url : '';
  const kind = sourceKind(typeof details.type === 'string' ? details.type : undefined, full);
  if (!kind) return;
  if (!(await isWatching())) return;
  const url = sourceUrl(full);
  if (url === '') return;
  const log = scriptsOf(tabId);
  if (log.byUrl.has(url) || log.byUrl.size >= MAX_SOURCE_SCRIPTS) return;
  const tabUrl = await browser.tabs
    .get(tabId)
    .then((t: { url?: string }) => t.url)
    .catch(() => undefined);
  log.byUrl.set(url, {
    full,
    kind,
    ...(mayFetchScript(full, tabUrl) ? {} : { error: PRIVATE_NETWORK_ERROR }),
  });
}

export function installSourcesWatch(): void {
  const api = (
    browser as unknown as {
      webRequest?: {
        onBeforeRequest?: {
          addListener(fn: (details: Record<string, unknown>) => void, filter: unknown): void;
        };
      };
    }
  ).webRequest;
  api?.onBeforeRequest?.addListener((details) => void seen(details), {
    urls: ['http://*/*', 'https://*/*'],
  });
  browser.tabs.onRemoved.addListener((tabId: number) => forget(tabId));
}

function cachedBytes(log: TabScripts): number {
  let n = 0;
  for (const s of log.byUrl.values()) n += s.text?.length ?? 0;
  return n;
}

/** Fetch the text once; later calls reuse it. Errors are kept so a failed script is not retried per search. */
async function load(log: TabScripts, script: Script): Promise<void> {
  if (script.text !== undefined || script.error !== undefined) return;
  if (cachedBytes(log) >= MAX_SOURCE_CACHE_BYTES) {
    script.error = 'the per-tab cache is full';
    return;
  }
  const tabUrl = await browser.tabs
    .get(log.tabId)
    .then((t: { url?: string }) => t.url)
    .catch(() => undefined);
  if (!mayFetchScript(script.full, tabUrl)) {
    script.error = PRIVATE_NETWORK_ERROR;
    return;
  }
  try {
    const res = await fetch(script.full, { credentials: 'omit', redirect: 'follow', cache: 'force-cache' });
    if (res.url && !mayFetchScript(res.url, tabUrl)) {
      script.error = PRIVATE_NETWORK_ERROR;
      return;
    }
    if (!res.ok) {
      script.error = `the site answered ${res.status}`;
      return;
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
      script.error = `${declared} bytes, over the ${MAX_SOURCE_BYTES} limit`;
      return;
    }
    const text = await res.text();
    if (text.length > MAX_SOURCE_BYTES) script.error = `over the ${MAX_SOURCE_BYTES} limit`;
    else script.text = text;
  } catch (err) {
    script.error = `the browser could not fetch it: ${(err as Error).message}`;
  }
}

function rowOf(url: string, s: Script): SourceRow {
  return {
    url,
    kind: s.kind,
    ...(s.text !== undefined ? { size: s.text.length, ...optional(sourceMapOf(s.text)) } : {}),
    ...(s.error ? { error: s.error } : {}),
  };
}

const optional = (map: string | undefined) => (map ? { sourceMap: map } : {});

export function sourcesAvailable(): boolean {
  return (browser as unknown as { webRequest?: unknown }).webRequest !== undefined;
}

export function listSources(tabId: number, urlFilter?: string): SourceRow[] {
  const log = tabs.get(tabId);
  if (!log) return [];
  return [...log.byUrl].filter(([url]) => matchesFilter(url, urlFilter)).map(([url, s]) => rowOf(url, s));
}

export async function searchSources(
  tabId: number,
  re: RegExp,
  opts: { urlFilter?: string; context: number; maxHits: number },
): Promise<{ hits: SourceHit[]; searched: number; truncated: boolean; scripts: SourceRow[] }> {
  const log = tabs.get(tabId);
  if (!log) return { hits: [], searched: 0, truncated: false, scripts: [] };
  const started = Date.now();
  const hits: SourceHit[] = [];
  let searched = 0;
  let truncated = false;
  for (const [url, script] of log.byUrl) {
    if (!matchesFilter(url, opts.urlFilter)) continue;
    if (Date.now() - started > SOURCE_SEARCH_BUDGET_MS || hits.length >= opts.maxHits) {
      truncated = true;
      break;
    }
    await load(log, script);
    if (script.text === undefined) continue;
    searched++;
    hits.push(...searchText(url, script.text, re, opts.context, opts.maxHits - hits.length));
  }
  if (hits.length >= opts.maxHits) truncated = true;
  return {
    hits,
    searched,
    truncated,
    scripts: [...log.byUrl].filter(([u]) => matchesFilter(u, opts.urlFilter)).map(([u, s]) => rowOf(u, s)),
  };
}

export async function textOf(tabId: number, url: string): Promise<{ text?: string; error?: string }> {
  const log = tabs.get(tabId);
  const script = log?.byUrl.get(sourceUrl(url));
  if (!log || !script)
    return { error: 'no such script was loaded by this tab; list shows the ones that were' };
  await load(log, script);
  return script.text !== undefined ? { text: script.text } : { error: script.error ?? 'unreadable' };
}
