/**
 * Did a write do anything? The answer an agent needs after a click that "succeeded".
 *
 * A click on a custom element can dispatch its events and reach nothing: the call returns ok and the
 * page is exactly as it was. The agent then carries on as if the step had happened. Comparing a
 * probe taken before with one taken after (browser-use does the same with its DOM state hash) turns
 * that silence into `none`.
 */

/** One look at a document: which one, where, and how many real mutations it has had. */
export type Probe = {
  doc: string;
  url: string;
  n: number;
  /** Form-control state of the clicked element (a checkbox's `checked` is a property, not a mutation). */
  f?: string;
};

export type Change = 'navigated' | 'changed' | 'none';

export type Verdict = {
  change: Change;
  /** The new address, only when the document was replaced or moved. */
  url?: string;
};

/** `after` missing means the document did not answer: after a write, that is a replaced document. */
export function verdictOf(before: Probe | undefined, after: Probe | undefined, landed?: string): Verdict {
  if (!after) return { change: 'navigated', ...(landed ? { url: landed } : {}) };
  if (!before) return { change: 'changed' };
  if (after.doc !== before.doc || after.url !== before.url) return { change: 'navigated', url: after.url };
  return { change: after.n !== before.n || after.f !== before.f ? 'changed' : 'none' };
}
