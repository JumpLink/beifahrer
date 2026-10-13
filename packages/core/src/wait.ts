/**
 * A `wait` that survives the page it waits on being replaced.
 *
 * The page agent answers a `wait` from inside the document. A navigation (a form that posts, a
 * login that redirects) destroys that document and the answer never comes: the browser reports it
 * as a dead channel. For a wait that is the expected case, not a failure, so the caller asks the
 * new document again until its own deadline. Pure on purpose: the extension supplies the browser
 * calls, the tests supply a script of failures.
 */

const GONE = [
  // Chromium and Firefox, no listener in the new document yet
  'receiving end does not exist',
  // Chromium, the document went away while the page agent was still answering
  'message port closed',
  'message channel closed',
  'frame with id',
  // Firefox, the actor of the old document was torn down mid-query
  'destroyed before query',
  'message manager disconnected',
  'back/forward cache',
  'no tab with id',
];

/** Does this error message say that the page we asked is no longer there? */
export function pageWentAway(message: string): boolean {
  const m = message.toLowerCase();
  return GONE.some((needle) => m.includes(needle));
}

export interface WaitAcrossNavigation<T> {
  /** Epoch ms after which the wait is over. */
  deadline: number;
  /** One ask of the current document, with the time left. */
  attempt(leftMs: number): Promise<T>;
  /** Called between a lost document and the next ask: wait for the new one to load, gate it again. */
  settle(): Promise<void>;
  /** The error's message when it is one; anything else is not ours to decide on. */
  messageOf(err: unknown): string | undefined;
  now?(): number;
}

export async function waitAcrossNavigation<T>(opts: WaitAcrossNavigation<T>): Promise<T> {
  const now = opts.now ?? Date.now;
  for (;;) {
    const left = Math.max(opts.deadline - now(), 100);
    try {
      return await opts.attempt(left);
    } catch (err) {
      const message = opts.messageOf(err);
      if (message === undefined || !pageWentAway(message) || now() >= opts.deadline) throw err;
      await opts.settle();
    }
  }
}
