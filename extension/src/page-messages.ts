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
  | { ok: false; code: 'not_found' | 'invalid' | 'failed' | 'timeout'; message: string };
