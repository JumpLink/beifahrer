/** Messages between the background and the page agent injected into a tab. */

import type { ElementQuery, MetaQuery } from '@beifahrer/core';

/**
 * The page agent's Stop button → background. The only message a content script may send, and it
 * can only pause (indicator.ts).
 */
export const STOP_MESSAGE = 'beifahrer-stop';

export type PageRequest = (
  | { beifahrer: 'read'; maxChars: number }
  | { beifahrer: 'outline'; maxItems: number }
  | { beifahrer: 'describe'; ref: string }
  | { beifahrer: 'fill'; ref: string; text: string; as: 'text' | 'html'; mode: 'replace' | 'append' }
  | { beifahrer: 'click'; ref: string }
  /**
   * A key, on an element or wherever the focus is. `text` types characters one after another,
   * which is a different thing from pressing one key: a page that listens for `input` per
   * character (a search field, a filter box) needs the second.
   */
  | { beifahrer: 'press'; ref?: string; key?: string; text?: string; times: number }
  /** Choose options in a `<select>`, by value or by the text the person reads. */
  | { beifahrer: 'select'; ref: string; values: string[]; add: boolean }
  /** Set a checkbox, a radio or a `role=checkbox` widget to checked or not. */
  | { beifahrer: 'check'; ref: string; checked: boolean }
  /**
   * The agent's own code, run in the page agent's isolated world (ADR 0012). The gate for
   * everything it can do was checked once, in the confirm window, before this message exists.
   */
  | { beifahrer: 'evaluate'; script: string; maxChars: number }
  /** A document the page links to: by ref (a link) or by URL on the tab's own origin. */
  | { beifahrer: 'download'; ref?: string; url?: string; maxBytes: number }
  /** Hide the in-page pill now, e.g. before a screenshot. Answers once the page has repainted. */
  | { beifahrer: 'hide' }
  | { beifahrer: 'find'; query: ElementQuery; maxResults: number }
  | { beifahrer: 'meta'; meta: MetaQuery }
  | { beifahrer: 'wait'; query: ElementQuery; timeoutMs: number }
) & {
  /** The agent session that asked (ADR 0007), named on the in-page pill. */
  session?: string;
};

export type PageResponse =
  | { ok: true; data: Record<string, unknown> }
  // `unsupported` is the page agent saying the BROWSER cannot do what was asked — today only
  // `page.evaluate` on a Manifest V3 build, where a content script's CSP forbids compiling a string
  // into code (ADR 0012). It is not a script error and not a failure of the page.
  | { ok: false; code: 'not_found' | 'invalid' | 'failed' | 'timeout' | 'unsupported'; message: string };
