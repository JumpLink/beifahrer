/** Messages between the background and the page agent injected into a tab. */

/**
 * The page agent's Stop button → background. The only message a content script may send, and it
 * can only pause (indicator.ts).
 */
export const STOP_MESSAGE = 'beifahrer-stop';

export type PageRequest =
  | { beifahrer: 'read'; maxChars: number }
  | { beifahrer: 'outline'; maxItems: number }
  | { beifahrer: 'describe'; ref: string }
  | { beifahrer: 'fill'; ref: string; text: string; as: 'text' | 'html'; mode: 'replace' | 'append' }
  | { beifahrer: 'click'; ref: string }
  /** Hide the in-page pill now, e.g. before a screenshot. Answers once the page has repainted. */
  | { beifahrer: 'hide' };

export type PageResponse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: 'not_found' | 'invalid' | 'failed'; message: string };
