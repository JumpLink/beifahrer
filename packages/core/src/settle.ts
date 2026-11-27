/**
 * Waiting for a page to be quiet after something happened to it.
 *
 * A single-page app answers a click, a navigation or a `fill` with work that is still going on when
 * the browser says "complete": a fetch that has not returned, a framework that has not rendered. An
 * agent that reads right away reads the page before the change. "Quiet" is the cheapest honest
 * answer to "is it done": the document is not loading, nothing in it has really changed for a
 * moment, and no request the page just made is still open.
 *
 * Idea and numbers from browser-use (`browser_use/ax.py`, MIT), adapted to what a WebExtension can
 * see: a content script observes the DOM, the background sees the requests, and neither can see
 * the other's half — so the loop here asks the page and consults the background, and stays pure.
 * The extension supplies the browser calls, the tests supply a script of answers.
 */

/** No real mutation for this long, and the page is quiet. */
export const SETTLE_QUIET_MS = 80;
/** Give up waiting after this long. A page that never settles (a ticker, a poll) must not hold a call. */
export const SETTLE_CAP_MS = 800;
/** The same, after a navigation: a new document needs time to render what the old one did not have. */
export const SETTLE_CAP_NAVIGATION_MS = 3_000;
/**
 * A request younger than this that is still open holds the page "busy". Older ones are a long poll
 * or a stream: the page lives with them, and waiting on them would only run into the cap.
 */
export const SETTLE_INFLIGHT_WINDOW_MS = 1_500;
/** A style change counts once per element per this long; an animation rewrites `style` every frame. */
export const SETTLE_STYLE_THROTTLE_MS = 200;
/** How often the loop looks again while it is waiting on something it cannot be told about. */
export const SETTLE_POLL_MS = 40;

/** What the page agent knows about its own document. */
export interface PageQuiet {
  /** A random id per document: a new one means the document was replaced. */
  doc: string;
  url: string;
  /** Real mutations counted since the agent started observing. */
  n: number;
  /** `document.readyState` is not `loading`. */
  ready: boolean;
  /** Ready, and no real mutation for the quiet window. */
  quiet: boolean;
}

/** `quiet`: nothing moved for the window. `cap`: gave up waiting and answered anyway. */
export type Settled = {
  settled: 'quiet' | 'cap';
  /** How long the wait took, in milliseconds. */
  ms: number;
};

export interface SettleDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /**
   * Ask the document to say when it is quiet, for at most `maxMs`. `undefined` means nobody
   * answered: the document was replaced or is not there yet, which after a write is a navigation.
   */
  ask(quietMs: number, maxMs: number): Promise<PageQuiet | undefined>;
  /** Requests of this tab still open and younger than {@link SETTLE_INFLIGHT_WINDOW_MS}. */
  inflight(): number;
  /** Is the tab itself still loading a document? */
  loading(): Promise<boolean>;
}

export interface SettleOptions {
  capMs?: number;
  navigationCapMs?: number;
  quietMs?: number;
  /** The document id from before the action. A different one in an answer means a navigation. */
  doc?: string;
  /** The caller already knows the tab is navigating (`page.navigate`). */
  navigation?: boolean;
}

export interface SettleOutcome extends Settled {
  /** The last answer the page gave; absent when it never did. */
  last?: PageQuiet;
  /** Did the document change, or was it still loading? */
  navigated: boolean;
}

export async function runSettle(deps: SettleDeps, options: SettleOptions = {}): Promise<SettleOutcome> {
  const quietMs = options.quietMs ?? SETTLE_QUIET_MS;
  const navigationCap = options.navigationCapMs ?? SETTLE_CAP_NAVIGATION_MS;
  let cap = options.navigation ? navigationCap : (options.capMs ?? SETTLE_CAP_MS);
  const start = deps.now();
  let navigated = options.navigation === true;
  let last: PageQuiet | undefined;
  for (;;) {
    const left = start + cap - deps.now();
    if (left <= 0) return { settled: 'cap', ms: deps.now() - start, navigated, ...(last ? { last } : {}) };
    const answer = await deps.ask(quietMs, left);
    // Silence is what a replaced document sounds like; the next ask goes to the new one.
    if (!answer) navigated = true;
    else {
      last = answer;
      if (options.doc !== undefined && answer.doc !== options.doc) navigated = true;
    }
    const loading = await deps.loading();
    if (loading) navigated = true;
    // A navigation gets the longer cap, and keeps it: the loop never shrinks it again.
    if (navigated) cap = Math.max(cap, navigationCap);
    if (answer?.ready && answer.quiet && !loading && deps.inflight() === 0) {
      return { settled: 'quiet', ms: deps.now() - start, navigated, last: answer };
    }
    await deps.sleep(SETTLE_POLL_MS);
  }
}
