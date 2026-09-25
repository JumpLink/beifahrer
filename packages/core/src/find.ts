/**
 * Element queries: how an agent, or a recipe, names an element without a ref and without code.
 *
 * A query is role + accessible name (+ visible text, + which match). It is DATA, matched by the
 * page agent against the same element model `page.outline` shows. There is no CSS selector and no
 * XPath on purpose: a selector language is a small program, and the one thing beifahrer never
 * runs is a program the agent supplied (no `evaluate`, AGENTS.md). Role + name is also what
 * survives a site's redesign better than class names do.
 *
 * Everything here is pure, so that the page agent, the extension's parameter check and the
 * recipe validator all share one definition and one set of tests.
 */

/** The roles the page agent assigns (`kindOf` in page-agent.ts). Nothing else can match. */
export const FIND_ROLES = [
  'heading',
  'link',
  'button',
  'textbox',
  'richtext',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
] as const;

export type FindRole = (typeof FIND_ROLES)[number];

export interface ElementQuery {
  role?: FindRole;
  /**
   * Substring of the accessible name, case- and whitespace-insensitive. Several strings = any of
   * them, which is how one recipe covers several UI languages.
   */
  name?: string | string[];
  /** Substring of the element's visible text, same normalisation. */
  text?: string;
  /** Which match, from 0 in document order. Absent: all (`page.find`) or the first (recipes). */
  nth?: number;
}

/**
 * A `<meta name=… content=…>` check, for app fingerprints ("is this an OpenProject?"). It answers
 * with a COUNT only, never the content: a `csrf-token` meta is on the page too, and a check that
 * echoed contents would read it out.
 */
export interface MetaQuery {
  name: string;
  /** Substring of `content`; absent = the meta only has to exist. */
  content?: string;
}

export const QUERY_LIMITS = { chars: 200, names: 10, maxNth: 99 } as const;

const QUERY_KEYS = new Set(['role', 'name', 'text', 'nth']);

/** Keys an agent or a recipe might reach for, and why each is refused. */
function refusedKey(key: string): string {
  if (/^(ref|refs)$/i.test(key))
    return `"${key}": refs belong to one page load — address elements by role and name`;
  if (/selector|xpath|css|query/i.test(key))
    return `"${key}": no selectors — address elements by role and name`;
  if (/script|code|eval|function|js/i.test(key)) return `"${key}": beifahrer runs no supplied code`;
  return `unknown key "${key}"`;
}

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/**
 * Validate a query from outside. Returns the reason on failure. Fail closed: an unknown key is an
 * error, not ignored — a query that silently dropped a key the author relied on would match MORE
 * than intended, which for a click is the wrong direction to fail in.
 */
export function parseElementQuery(raw: unknown): ElementQuery | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'a query must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!QUERY_KEYS.has(key)) return refusedKey(key);
  const query: ElementQuery = {};
  if (src.role !== undefined) {
    if (!(FIND_ROLES as readonly unknown[]).includes(src.role))
      return `role must be one of ${FIND_ROLES.join(', ')}`;
    query.role = src.role as FindRole;
  }
  if (src.name !== undefined) {
    const names = Array.isArray(src.name) ? src.name : [src.name];
    if (names.length === 0 || names.length > QUERY_LIMITS.names)
      return `name takes 1 to ${QUERY_LIMITS.names} strings`;
    if (!names.every((n) => isString(n, QUERY_LIMITS.chars)))
      return `name must be non-empty strings of at most ${QUERY_LIMITS.chars} characters`;
    query.name = Array.isArray(src.name) ? (names as string[]) : (src.name as string);
  }
  if (src.text !== undefined) {
    if (!isString(src.text, QUERY_LIMITS.chars))
      return `text must be a non-empty string of at most ${QUERY_LIMITS.chars} characters`;
    query.text = src.text;
  }
  if (src.nth !== undefined) {
    if (
      typeof src.nth !== 'number' ||
      !Number.isInteger(src.nth) ||
      src.nth < 0 ||
      src.nth > QUERY_LIMITS.maxNth
    )
      return `nth must be an integer from 0 to ${QUERY_LIMITS.maxNth}`;
    query.nth = src.nth;
  }
  // A query naming nothing matches every element on the page — for a click, that is a guess.
  if (!query.role && !query.name && !query.text) return 'a query needs at least one of role, name, text';
  return query;
}

export function parseMetaQuery(raw: unknown): MetaQuery | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'meta must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (key !== 'name' && key !== 'content') return refusedKey(key);
  if (!isString(src.name, QUERY_LIMITS.chars) || !/^[A-Za-z0-9_.:-]+$/.test(src.name))
    return 'meta.name must be a meta name like "generator"';
  if (src.content !== undefined && !isString(src.content, QUERY_LIMITS.chars))
    return `meta.content must be a non-empty string of at most ${QUERY_LIMITS.chars} characters`;
  return src.content === undefined ? { name: src.name } : { name: src.name, content: src.content as string };
}

/** Lowercase, whitespace collapsed, trimmed: "Kommentar\n  absenden" matches "kommentar absenden". */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** What the page agent knows about one element, to match a query against. */
export interface ElementFacts {
  role: FindRole;
  name: string;
  text: string;
}

/** Does the element match role, name and text? (`nth` is applied by the caller over the list.) */
export function queryMatches(query: ElementQuery, el: ElementFacts): boolean {
  if (query.role && query.role !== el.role) return false;
  if (query.name !== undefined) {
    const name = normalizeText(el.name);
    const wanted = Array.isArray(query.name) ? query.name : [query.name];
    if (!wanted.some((n) => name.includes(normalizeText(n)))) return false;
  }
  if (query.text !== undefined && !normalizeText(el.text).includes(normalizeText(query.text))) return false;
  return true;
}

/** Does a `<meta>` match? Names compare case-insensitively, as HTML does. */
export function metaMatches(query: MetaQuery, meta: { name: string; content: string }): boolean {
  if (meta.name.toLowerCase() !== query.name.toLowerCase()) return false;
  return query.content === undefined || normalizeText(meta.content).includes(normalizeText(query.content));
}

/** A short human-readable form, for logs and error messages. */
export function describeQuery(query: ElementQuery): string {
  const parts: string[] = [query.role ?? 'element'];
  if (query.name !== undefined)
    parts.push(Array.isArray(query.name) ? query.name.map((n) => `"${n}"`).join(' | ') : `"${query.name}"`);
  if (query.text !== undefined) parts.push(`with text "${query.text}"`);
  if (query.nth !== undefined) parts.push(`#${query.nth}`);
  return parts.join(' ');
}
