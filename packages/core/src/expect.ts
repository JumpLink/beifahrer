/**
 * What `page.expect` may be asked, and what it may not (issue #35).
 *
 * `page_wait` answers one question — "is there an element matching this". A page has more states than
 * that, and each is something an agent asks for and cannot check any other way: a spinner that has to
 * go away before the next step, a submit button a form enables once its validation passes, a field that
 * must hold a value, a confirmation screen with one string on it that matters.
 *
 * So this is a CONDITION, not a lookup, and the three are kept apart on purpose: `page_find` finds,
 * `page_wait` waits for one shape to exist, `page_expect` asserts a state and — the part that makes it
 * worth its own method — says on failure what it SAW. An assertion whose failure sends the agent back
 * to read the page is the loop this exists to remove.
 *
 * Pure, so the bounds are testable without a browser: the same reason `find.ts` and `keys.ts` are.
 */

import { describeQuery, parseElementQuery, type ElementQuery } from './find.ts';

/** The states one element can be asserted to be in. */
export const EXPECT_STATES = [
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'checked',
  'unchecked',
  'focused',
] as const;

export type ExpectState = (typeof EXPECT_STATES)[number];

/** As long as `page_wait` may look. Longer is a hung browser, not a slow page. */
export const MAX_EXPECT_MS = 30_000;

/** An expected value or text is what the person reads in the failure message. */
export const MAX_EXPECT_TEXT = 200;

const KEYS = new Set(['ref', 'query', 'state', 'value', 'text', 'count', 'timeoutMs', 'tabId', 'browser']);

export interface ExpectRequest {
  /** A specific element, possibly in a frame (`b2e12`). */
  ref?: string;
  /** Or: elements by role and accessible name, in every document the person allowed. */
  query?: ElementQuery;
  /**
   * Defaults to `visible` — but only when something ELSE was asked for. An `expect` with nothing to
   * check is refused below rather than answered with a default, because that answer would be `pass`
   * about a page nobody looked at.
   */
  state?: ExpectState;
  /** The control's value, compared EXACTLY: a value is an exact thing. */
  value?: string;
  /**
   * The element's own text, compared as a SUBSTRING: a sentence is not an exact thing.
   *
   * A CONDITION, never a selector — and the query it travels with has a `text` of its own, meaning
   * "the element whose text is …". One key with two meanings is how a caller who wrote a condition
   * gets a filter instead: the query matches nothing, the condition is never looked at, and the
   * failure says "nothing matched the query" about an element that is right there. So `page_expect`
   * picks elements by role, accessible name and position, and this field is always the claim.
   */
  text?: string;
  /** Exactly this many matches. Zero is meaningful — "nothing here any more". */
  count?: number;
  timeoutMs: number;
}

/**
 * Validate what came in. Fail closed, like every other parser here, and reuse `parseElementQuery`
 * rather than a second, looser copy of it: two validators for one shape is how a query starts meaning
 * two things.
 */
export function parseExpect(raw: unknown): ExpectRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'params must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!KEYS.has(key)) return `unknown key "${key}"`;

  const { ref, state, value, text, count } = src;
  const hasRef = ref !== undefined;
  const hasQuery = src.query !== undefined && src.query !== null;
  if (hasRef === hasQuery) {
    return hasRef
      ? 'give a ref OR a query, not both — a ref names one element, a query names a kind of element'
      : 'page.expect needs a ref or a query to look at';
  }
  if (hasRef && typeof ref !== 'string') return 'ref must be a string like e12 or b2e12';

  let query: ElementQuery | undefined;
  if (hasQuery) {
    const parsed = parseElementQuery(src.query);
    if (typeof parsed === 'string') return parsed;
    query = parsed;
  }

  if (
    state !== undefined &&
    (typeof state !== 'string' || !(EXPECT_STATES as readonly unknown[]).includes(state))
  )
    return `state must be one of ${EXPECT_STATES.join(', ')}`;
  if (value !== undefined && typeof value !== 'string') return 'value must be a string';
  if (text !== undefined && typeof text !== 'string') return 'text must be a string';
  if (typeof value === 'string' && value.length > MAX_EXPECT_TEXT)
    return `value is ${value.length} characters, over the ${MAX_EXPECT_TEXT} limit`;
  if (typeof text === 'string' && text.length > MAX_EXPECT_TEXT)
    return `text is ${text.length} characters, over the ${MAX_EXPECT_TEXT} limit`;
  if (count !== undefined && (!Number.isInteger(count) || (count as number) < 0))
    return 'count must be a whole number of at least 0';
  // With a ref there is exactly one element, so `count` has nothing to count — and answering it
  // anyway would let "count: 0" pass on a ref that exists, which is the one reading nobody means.
  if (count !== undefined && hasRef)
    return 'count asks how many elements match a query — a ref is one element by definition';

  // A condition. "Expect what?" is refused rather than defaulted, and the refusal is worth the extra
  // sentence: the default would be `visible`, so the silent answer would be a `pass` about an element
  // the agent never described.
  if (state === undefined && value === undefined && text === undefined && count === undefined)
    return 'page.expect needs a state, a value, a text or a count to check';

  const asked = Number(src.timeoutMs ?? 10_000);
  const timeoutMs = Number.isFinite(asked) ? Math.min(Math.max(asked, 100), MAX_EXPECT_MS) : 10_000;
  return {
    ...(hasRef ? { ref: ref as string } : {}),
    ...(query ? { query } : {}),
    ...(state !== undefined ? { state: state as ExpectState } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(count !== undefined ? { count: count as number } : {}),
    timeoutMs,
  };
}

/**
 * The sentence a failure uses, so the extension, the bridge and the tests say the same thing. Built
 * here rather than in the failure branch, because a message that only exists on the way out is a
 * message nobody checks.
 *
 * The QUERY is named, not called "the query": `expected` and `seen` are the two halves of a failure
 * report, and an agent reading "the query to be enabled" next to "the element is visible disabled"
 * has to go back to the call it made to work out which element was meant. `describeQuery` already
 * says a query in words for the recipe runner, so this is that one and not a second wording.
 */
export function expectationOf(req: ExpectRequest): string {
  const where = req.ref ? `ref ${req.ref}` : `the ${describeQuery(req.query ?? {})}`;
  const parts: string[] = [];
  if (req.count !== undefined) parts.push(`exactly ${req.count} match${req.count === 1 ? '' : 'es'}`);
  if (req.state !== undefined) parts.push(req.state);
  if (req.value !== undefined) parts.push(`value "${req.value}"`);
  if (req.text !== undefined) parts.push(`text containing "${req.text}"`);
  return `${where} to be ${parts.join(' and ')}`;
}
