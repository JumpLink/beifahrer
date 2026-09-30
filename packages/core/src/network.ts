/**
 * What a tab requested, and what may be said about it (issue #35).
 *
 * A page's console is not readable by an extension at all (AGENTS.md, ADR 0012), so "the button did
 * nothing" is answered here: the POST that returned 500, the request a CSP or a CORS header refused
 * before it went out, the third-party script that never loaded. The browser's `webRequest` API sees
 * all of that and nothing about the page's internals — which is exactly the right size for a tool an
 * agent runs with the person's browser.
 *
 * Two decisions are baked in rather than left to the caller, and both are privacy decisions the
 * person should not have to re-make per call:
 *
 * - **The query is never reported.** `?token=`, `?access_token=`, `?SAMLRequest=` are ordinary, a
 *   request log is the ideal place to leak one, and the person cannot review an argument an agent
 *   chose. The path is kept, because the path is what says which endpoint it was. A per-call
 *   `includeQuery` was considered and refused: it would hand the decision to the agent, and this
 *   project's whole claim is that the person holds those. Should the person ever want queries, that
 *   is a switch in THEIR options page, not an argument.
 * - **Only http(s).** A `data:` or `blob:` URL carries the bytes of something else and has no host to
 *   gate on, and neither is a request anyone debugs a page with.
 * - **No headers, no bodies.** `webRequest` would hand over `Cookie` and `Authorization` — the
 *   person's own credentials, to an agent, in a tool they were only asked to look at a page with — and
 *   a request body is their data. The status line is the answer to "did it work", and that is all
 *   this carries.
 *
 * Pure, so the bounds and the redaction are testable without a browser — the same reason `find.ts`,
 * `expect.ts` and `navigate.ts` are.
 */

/** How long a method or an error may be before it is cut — the browser's own words, not ours. */
const MAX_WORD = 64;

/** How many requests one tab's log holds. Enough to see a page load, not a browsing session. */
export const MAX_NETWORK_ROWS = 200;

/** How many of them one call may return. */
export const MAX_NETWORK_LIMIT = 200;

/** The longest a URL may be before it is cut — a data: URL is megabytes and says nothing. */
export const MAX_NETWORK_URL = 300;

/** One request, as far as the agent is told. */
export interface NetworkRow {
  /** When the browser reported it (ms since the epoch), for ordering against the page's own steps. */
  at: number;
  method: string;
  /** The URL without query and fragment — see the note above on why. */
  url: string;
  /** The status, once the request finished. Absent while it is still in flight or if it failed. */
  status?: number;
  /** `net::ERR_*` as the browser words it, when the request never got an answer. */
  error?: string;
  /** The browser's own type: `main_frame`, `script`, `xmlhttprequest`, `image`, … */
  type?: string;
  /** Which frame of the tab asked. beifahrer's own index, 0 for the page. */
  frame: number;
  /** True while the request is still open — the answer to "did it ever go out". */
  pending: boolean;
}

const KEYS = new Set(['tabId', 'limit', 'since', 'browser']);

export interface NetworkRequest {
  /** How many of the newest rows to return. */
  limit: number;
  /** Only rows newer than this (ms since the epoch) — "what has it done since I clicked". */
  since: number;
}

/** Validate what came in. Fail closed, like every other parser here. */
export function parseNetwork(raw: unknown): NetworkRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'params must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!KEYS.has(key)) return `unknown key "${key}"`;

  const asked = Number(src.limit ?? 50);
  if (!Number.isFinite(asked) || asked < 1)
    return 'limit must be a whole number of at least 1 — a log of nothing is not a log';
  const limit = Math.min(Math.floor(asked), MAX_NETWORK_LIMIT);
  const since = Number(src.since ?? 0);
  if (!Number.isFinite(since) || since < 0)
    return 'since must be a time in milliseconds, not before the epoch';
  return { limit, since };
}

/**
 * A URL as the agent may see it: no query, no fragment, and never a `data:` or `blob:` one, which
 * is not a request at all but the bytes of something else.
 *
 * Stripping the query is the whole privacy argument of this method, so it happens where the row is
 * BUILT rather than where it is printed: a row that kept the query anywhere would be one refactor
 * away from handing it over.
 */
export function redactUrl(raw: string): string {
  if (typeof raw !== 'string' || raw === '') return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  const cut = raw.search(/[?#]/);
  const bare = cut === -1 ? raw : raw.slice(0, cut);
  return bare.length > MAX_NETWORK_URL ? `${bare.slice(0, MAX_NETWORK_URL - 1)}…` : bare;
}

/** A request the extension reports, before the bounds above are applied — the shape `webRequest` gives. */
export interface WebRequestFacts {
  requestId: string;
  tabId?: number;
  frameId?: number;
  method?: string;
  url?: string;
  statusCode?: number;
  error?: string;
  type?: string;
  timeStamp?: number;
  at: number;
}

/**
 * The row for a `webRequest` event, or null when the event is not one an agent may hear: another
 * tab's request (the buffer is per tab, so the caller checks), or a URL that is not http(s).
 *
 * The `at` a caller passes wins over the browser's `timeStamp`: MV3 reports it in milliseconds since
 * the epoch like everything else, but Firefox has been seen reporting seconds, and a log whose order
 * is wrong is worse than no log.
 */
export function networkRow(facts: WebRequestFacts, frame: number, pending: boolean): NetworkRow | null {
  const url = redactUrl(facts.url ?? '');
  if (url === '') return null;
  const method = (facts.method ?? 'GET').toUpperCase().slice(0, MAX_WORD);
  return {
    at: facts.at || Date.now(),
    method,
    url,
    ...(typeof facts.statusCode === 'number' ? { status: facts.statusCode } : {}),
    ...(facts.error ? { error: facts.error.slice(0, MAX_WORD) } : {}),
    ...(facts.type ? { type: facts.type } : {}),
    frame,
    pending,
  };
}

/**
 * The rows a call answers with: the newest `limit` of them, in the order they happened, and only
 * those newer than `since`.
 *
 * Newest first is deliberate — a log is read from the end, the last request is the one that explains
 * what just happened — and it is why `limit` counts from the end and not from the start.
 */
export function selectRows(rows: NetworkRow[], { limit, since }: NetworkRequest): NetworkRow[] {
  return rows
    .filter((row) => row.at > since)
    .slice(-limit)
    .reverse();
}
