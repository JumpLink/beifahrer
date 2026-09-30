/**
 * What a navigation request is, as DATA, before a tab is moved (issue: navigation without a goto).
 *
 * Pure, for the same reason `keys.ts` is: the extension, the bridge and the tests have to agree on
 * one set of rules without a browser, and the rules here are the ones that keep a navigation from
 * becoming a way around the per-origin level.
 *
 * `page.navigate` moves the PERSON'S tab, and that is a different thing from opening a new one. The
 * destination is checked like `tabs.open`'s: a new URL needs `read` on the site it names, or the
 * agent could carry away what it just read in the query string of a site nobody allowed. Going back
 * or forward names no URL at all — the browser offers no way to ask where a history entry points —
 * so the bound there is the tab itself: where it is NOW, which the person has in front of them,
 * and where they were a moment ago. A landing below `read` is reported as `forbidden` with the new
 * origin, so the agent stops instead of reading a page the person blocked.
 */

export const NAVIGATIONS = ['url', 'back', 'forward', 'reload'] as const;

export type Navigation = (typeof NAVIGATIONS)[number];

export interface NavigateRequest {
  /** Set for `url`; absent for the three history moves, which name no destination. */
  url?: string;
  navigation: Navigation;
  /** How long to wait for the new document. Bounded by the caller, capped here. */
  timeoutMs: number;
}

/** One page load is seconds, not minutes; past this the answer is more useful than the wait. */
export const MAX_NAVIGATE_MS = 30_000;

const KEYS = new Set(['url', 'navigation', 'timeoutMs']);

/**
 * Validate what came in over the wire. Fail closed like every other parser here: an unknown key is
 * an error, never ignored, and a request must name EXACTLY one destination — a `url` together with
 * `back` has no defined meaning, and picking one of the two would move a tab in a direction the
 * caller did not ask for.
 */
export function parseNavigate(raw: unknown): NavigateRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'params must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!KEYS.has(key)) return `unknown key "${key}"`;

  const askedMove = src.navigation;
  // `url` is the default move, so the common call does not have to learn the word for it. It is a
  // default and not a guess: the other three moves are named by a word that is not a URL, and a
  // request that names nothing at all is refused below rather than taken for a URL that is absent.
  const navigation = askedMove === undefined && typeof src.url === 'string' ? 'url' : askedMove;
  if (typeof navigation !== 'string' || !NAVIGATIONS.includes(navigation as Navigation))
    return `navigation must be one of ${NAVIGATIONS.join(', ')} (it defaults to "url" when a url is given)`;
  if (navigation === 'url') {
    if (typeof src.url !== 'string' || src.url.trim() === '') return 'navigation "url" needs a url';
    // The same reason a script longer than the window may not run: a URL is what a person reads
    // when they answer, and an unbounded one is a paragraph nobody reads.
    if (src.url.length > 4_000) return `url is ${src.url.length} characters, over the 4000 limit`;
  } else if (src.url !== undefined) {
    // Not a warning: a caller that sends both means something the protocol does not define, and
    // guessing which of the two it meant is a guess about where a person's tab goes.
    return `navigation "${navigation}" names no url — drop the url, or use navigation "url"`;
  }

  const askedMs = Number(src.timeoutMs ?? 10_000);
  const timeoutMs = Number.isFinite(askedMs) ? Math.min(Math.max(askedMs, 100), MAX_NAVIGATE_MS) : 10_000;
  return {
    navigation: navigation as Navigation,
    ...(navigation === 'url' ? { url: src.url as string } : {}),
    timeoutMs,
  };
}
