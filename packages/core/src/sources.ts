/**
 * The scripts a tab loaded, and how an agent may search them (issue #234).
 *
 * To check how a site's own web client does something, an agent has to read the JavaScript the
 * site serves. `page_evaluate` could do it in Firefox only, behind a prompt, and never saw what a
 * worker imported. This is the read-only answer: a list of script URLs from `webRequest`, a search
 * over their text and a slice to read around a hit.
 *
 * Three decisions are baked in:
 *
 * - **Only what every visitor gets.** The extension fetches a script WITHOUT the person's cookies
 *   (`credentials: 'omit'`), so a URL that serves something different to a signed-in session is
 *   not turned into a way to read it. No page state, no storage.
 * - **The query never leaves.** URLs are reported without query and fragment (`redactUrl`, as in
 *   `page_network`); `url` arguments are matched against that form.
 * - **Everything is capped**, here, so the caps are testable without a browser.
 *
 * Pure for the same reason `network.ts` is.
 */

import { redactUrl } from './network.ts';

/** Scripts one tab remembers. A page load is tens of bundles, not thousands. */
export const MAX_SOURCE_SCRIPTS = 300;
/** The most one script may weigh before it is not read. */
export const MAX_SOURCE_BYTES = 8_000_000;
/** The most all of a tab's cached text may weigh. */
export const MAX_SOURCE_CACHE_BYTES = 80_000_000;
/** Hits one search returns. */
export const MAX_SOURCE_HITS = 100;
/** Characters of context either side of a hit. */
export const MAX_SOURCE_CONTEXT = 500;
/** Characters one slice returns. */
export const MAX_SOURCE_SLICE = 20_000;
/** The longest pattern accepted — a regex is the one input here that can burn time. */
export const MAX_SOURCE_PATTERN = 200;
/** Wall-clock budget of one search, checked between scripts. */
export const SOURCE_SEARCH_BUDGET_MS = 15_000;

export const SOURCE_ACTIONS = ['list', 'search', 'slice'] as const;
export type SourceAction = (typeof SOURCE_ACTIONS)[number];

/** `script`: a `<script>` or worker script; `fetched`: a .js file requested by fetch/XHR (modules a worker imports). */
export type SourceKind = 'script' | 'fetched';

export interface SourceRow {
  /** Without query and fragment. */
  url: string;
  kind: SourceKind;
  /** Characters read, once the text has been fetched. */
  size?: number;
  /** From `//# sourceMappingURL=`, once the text has been fetched. */
  sourceMap?: string;
  /** Why the text could not be read, once it was tried. */
  error?: string;
}

export interface SourceHit {
  url: string;
  offset: number;
  /** The match with `context` characters either side. */
  text: string;
}

export interface SourcesRequest {
  action: SourceAction;
  pattern?: string;
  literal: boolean;
  urlFilter?: string;
  context: number;
  maxHits: number;
  url?: string;
  offset: number;
  length: number;
}

const KEYS = new Set([
  'tabId',
  'browser',
  'action',
  'pattern',
  'literal',
  'urlFilter',
  'context',
  'maxHits',
  'url',
  'offset',
  'length',
]);

const whole = (v: unknown, fallback: number, min: number, max: number): number | string => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return `must be a whole number of at least ${min}`;
  return Math.min(Math.floor(n), max);
};

/** Validate what came in. Fail closed, like every other parser here. */
export function parseSources(raw: unknown): SourcesRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'params must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!KEYS.has(key)) return `unknown key "${key}"`;
  if (!SOURCE_ACTIONS.includes(src.action as SourceAction))
    return `action must be one of ${SOURCE_ACTIONS.join(', ')}`;
  const action = src.action as SourceAction;
  const context = whole(src.context, 80, 0, MAX_SOURCE_CONTEXT);
  if (typeof context === 'string') return `context ${context}`;
  const maxHits = whole(src.maxHits, 20, 1, MAX_SOURCE_HITS);
  if (typeof maxHits === 'string') return `maxHits ${maxHits}`;
  const offset = whole(src.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (typeof offset === 'string') return `offset ${offset}`;
  const length = whole(src.length, 2_000, 1, MAX_SOURCE_SLICE);
  if (typeof length === 'string') return `length ${length}`;
  for (const key of ['pattern', 'urlFilter', 'url'] as const)
    if (src[key] !== undefined && typeof src[key] !== 'string') return `${key} must be a string`;
  if (src.literal !== undefined && typeof src.literal !== 'boolean') return 'literal must be a boolean';
  const pattern = src.pattern as string | undefined;
  if (action === 'search') {
    if (!pattern) return 'search needs a pattern';
    if (pattern.length > MAX_SOURCE_PATTERN) return `pattern is longer than ${MAX_SOURCE_PATTERN} characters`;
  }
  if (action === 'slice' && !src.url) return 'slice needs the url of a script from list';
  return {
    action,
    ...(pattern ? { pattern } : {}),
    literal: src.literal === true,
    ...(src.urlFilter ? { urlFilter: src.urlFilter as string } : {}),
    context,
    maxHits,
    ...(src.url ? { url: src.url as string } : {}),
    offset,
    length,
  };
}

/** A pattern as a global, case-insensitive RegExp, or the reason it is not one. */
export function compilePattern(pattern: string, literal: boolean): RegExp | string {
  try {
    return new RegExp(literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, 'gi');
  } catch (err) {
    return `pattern is not a valid regular expression: ${(err as Error).message}`;
  }
}

/** The `//# sourceMappingURL=` of a script, from its tail, without query. */
export function sourceMapOf(text: string): string | undefined {
  const tail = text.slice(-2_000);
  const m = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/m.exec(tail);
  if (!m || m[1].startsWith('data:')) return undefined;
  const cut = m[1].search(/[?#]/);
  return (cut === -1 ? m[1] : m[1].slice(0, cut)).slice(0, 300);
}

/** Does a script belong to the URL filter? A plain substring, case-insensitive. */
export const matchesFilter = (url: string, filter?: string): boolean =>
  !filter || url.toLowerCase().includes(filter.toLowerCase());

/**
 * Hits in one script's text. Stops at `room` hits; an empty match advances so the loop ends.
 */
export function searchText(
  url: string,
  text: string,
  re: RegExp,
  context: number,
  room: number,
): SourceHit[] {
  const hits: SourceHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (hits.length < room && (m = re.exec(text)) !== null) {
    if (m[0] === '') re.lastIndex++;
    const from = Math.max(0, m.index - context);
    const to = Math.min(text.length, m.index + m[0].length + context);
    hits.push({ url, offset: m.index, text: text.slice(from, to) });
  }
  return hits;
}

/** `length` characters of `text` from `offset`, and whether more follows. */
export function sliceText(
  text: string,
  offset: number,
  length: number,
): { offset: number; text: string; total: number; more: boolean } {
  const start = Math.min(offset, text.length);
  const part = text.slice(start, start + length);
  return { offset: start, text: part, total: text.length, more: start + part.length < text.length };
}

/** A script URL as the agent may see it; '' when it is not http(s). */
export const sourceUrl = (raw: string): string => redactUrl(raw);

/** Is this a request worth listing: a script, or a .js file fetched by script or worker. */
export function sourceKind(type: string | undefined, rawUrl: string): SourceKind | null {
  if (type === 'script') return 'script';
  if (type === 'xmlhttprequest' || type === 'fetch' || type === 'other') {
    const path = rawUrl.split(/[?#]/)[0];
    return /\.m?js$/i.test(path) ? 'fetched' : null;
  }
  return null;
}

/** Why a script on the person's own network is listed but never fetched. */
export const PRIVATE_NETWORK_ERROR = 'a private-network address, not fetched';

/**
 * Is this host the person's own machine or network: loopback, RFC 1918, link-local, unique-local,
 * `localhost`, `*.local`, `*.internal`, or a dotless name? IPv6 may come bracketed.
 *
 * The extension fetches with host permissions and no CORS, so a hostile page that names
 * `http://192.168.1.1/x.js` in a `<script>` would otherwise make the agent's search read the intranet.
 */
export function isPrivateHost(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === '') return true;
  if (h.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateHost(mapped[1]!);
    if (h === '::' || h === '::1') return true;
    const first = h.split(':')[0] ?? '';
    const n = first === '' ? 0 : parseInt(first, 16);
    if (Number.isNaN(n)) return true;
    return (n & 0xfe00) === 0xfc00 || (n & 0xffc0) === 0xfe80;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (/^[0-9x.]+$/.test(h)) return true;
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    !h.includes('.')
  );
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * May the extension fetch this script for a tab on `tabUrl`? A public tab may not pull private
 * addresses; a tab that is itself on the private network (a developer on localhost) may.
 */
export function mayFetchScript(scriptUrl: string, tabUrl: string | undefined): boolean {
  const host = hostOf(scriptUrl);
  if (host === null) return false;
  if (!isPrivateHost(host)) return true;
  const tabHost = tabUrl ? hostOf(tabUrl) : null;
  return tabHost !== null && isPrivateHost(tabHost);
}
