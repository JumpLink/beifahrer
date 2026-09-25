/** Messages between the background and the page agent injected into a tab. */

export type PageRequest =
  | { beifahrer: 'read'; maxChars: number }
  | { beifahrer: 'outline'; maxItems: number }
  | { beifahrer: 'describe'; ref: string }
  | { beifahrer: 'fill'; ref: string; text: string; as: 'text' | 'html'; mode: 'replace' | 'append' }
  | { beifahrer: 'click'; ref: string };

export type PageResponse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: 'not_found' | 'invalid' | 'failed'; message: string };
