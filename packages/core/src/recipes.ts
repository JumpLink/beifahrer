/**
 * Recipes: a site-specific task as DATA — "add a comment on an OpenProject work package" —
 * shareable, reviewable, and unable to do anything a single tool call could not.
 *
 * A recipe is a list of steps over the existing page methods (find, click, fill, wait, read,
 * outline). The bridge runs it as a macro: one protocol call per step, so the extension checks
 * every step exactly like a call the agent made itself — policy, host permission, confirmation
 * window. The extension knows nothing about recipes, and a recipe cannot bypass anything
 * (ADR 0005).
 *
 * This file is the format and its validator. Pure, so that every way a recipe file can be wrong
 * is a unit test. The validator fails CLOSED: an unknown key, step type or role rejects the whole
 * recipe — a half-understood recipe is not run half.
 */

import { parseElementQuery, parseMetaQuery, type ElementQuery, type MetaQuery } from './find.ts';

/** A recipe file larger than this is refused unread. Real ones are a few KiB. */
export const MAX_RECIPE_BYTES = 64 * 1024;
export const MAX_STEPS = 50;
export const MAX_PARAMS = 10;
/** A single `wait` step, and `page.wait`, never waits longer than this. */
export const MAX_WAIT_MS = 30_000;
/** A param value (the text a `fill` step writes). Same bound as `page.fill`. */
export const MAX_PARAM_CHARS = 100_000;

export interface RecipeParam {
  name: string;
  type: 'string';
  description: string;
  required: boolean;
}

/** One fingerprint check: an element must exist, or a `<meta>` must. */
export type FingerprintCheck = { find: ElementQuery } | { meta: MetaQuery };

/**
 * Where a recipe applies. Every part that is present must hold (AND). A recipe lists several
 * matchers when any of them may do (OR) — e.g. a customer's known domain OR the app fingerprint.
 */
export interface Matcher {
  /** Match patterns like `https://*.example.org/work_packages/*` (see `urlPatternMatches`). */
  urls?: string[];
  /** Checks run on the page itself; all must hold. How a self-hosted app is recognised on any domain. */
  fingerprint?: FingerprintCheck[];
}

interface StepBase {
  /** Unique within the recipe; what `from` / `until` of a run point at. */
  id: string;
  /** Shown in the run log. */
  note?: string;
  /**
   * The step is only run when the person asked for exactly this action (e.g. posting the
   * comment). Without it, a run stops BEFORE the step and says so.
   */
  requiresExplicitRequest?: boolean;
}

export type Step =
  | (StepBase & { action: 'find'; target: ElementQuery })
  | (StepBase & { action: 'click'; target: ElementQuery })
  | (StepBase & { action: 'submit'; target: ElementQuery; requiresExplicitRequest: true })
  | (StepBase & {
      action: 'fill';
      target: ElementQuery;
      param: string;
      as?: 'text' | 'html';
      mode?: 'replace' | 'append';
    })
  | (StepBase & { action: 'wait'; for: 'load' | ElementQuery; timeoutMs?: number })
  | (StepBase & { action: 'read'; maxChars?: number })
  | (StepBase & { action: 'outline'; maxItems?: number })
  | (StepBase & { action: 'checkpoint'; message: string });

export type StepAction = Step['action'];

export const STEP_ACTIONS: readonly StepAction[] = [
  'find',
  'click',
  'submit',
  'fill',
  'wait',
  'read',
  'outline',
  'checkpoint',
];

/** Steps that change the page, and so go through the write gate + confirmation. */
export const WRITE_ACTIONS: ReadonlySet<StepAction> = new Set(['click', 'submit', 'fill']);

export interface Recipe {
  id: string;
  title: string;
  description: string;
  version: string;
  match: Matcher[];
  params: RecipeParam[];
  steps: Step[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,59}$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const PARAM_NAME = /^[a-z][A-Za-z0-9_]{0,39}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

const TOP_KEYS = new Set(['$schema', 'id', 'title', 'description', 'version', 'match', 'params', 'steps']);
const STEP_KEYS: Record<StepAction, string[]> = {
  find: ['target'],
  click: ['target'],
  submit: ['target'],
  fill: ['target', 'param', 'as', 'mode'],
  wait: ['for', 'timeoutMs'],
  read: ['maxChars'],
  outline: ['maxItems'],
  checkpoint: ['message'],
};
const COMMON_STEP_KEYS = ['id', 'action', 'note', 'requiresExplicitRequest'];

class Invalid extends Error {}

function fail(where: string, reason: string): never {
  throw new Invalid(`${where}: ${reason}`);
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'must be an object');
  return value as Record<string, unknown>;
}

function str(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(where, 'must be a non-empty string');
  if (value.length > max) fail(where, `is longer than ${max} characters`);
  return value;
}

function arr(value: unknown, where: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be an array');
  if (value.length < min || value.length > max) fail(where, `must have ${min} to ${max} entries`);
  return value;
}

function onlyKeys(src: Record<string, unknown>, allowed: Iterable<string>, where: string): void {
  const set = new Set(allowed);
  for (const key of Object.keys(src)) {
    if (set.has(key)) continue;
    if (/^(ref|refs)$/i.test(key))
      fail(where, `"${key}": steps address elements by role and name, never by ref`);
    if (/selector|xpath|css/i.test(key))
      fail(where, `"${key}": no selectors — address elements by role and name`);
    if (/script|code|eval|function|^js$/i.test(key)) fail(where, `"${key}": a recipe carries no code`);
    fail(where, `unknown key "${key}"`);
  }
}

function query(value: unknown, where: string): ElementQuery {
  const q = parseElementQuery(value);
  if (typeof q === 'string') fail(where, q);
  return q;
}

function int(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    fail(where, `must be an integer from ${min} to ${max}`);
  return value;
}

/**
 * A URL match pattern, WebExtension-style but narrower: `<scheme>://<host><path>`.
 * - scheme: `http`, `https` or `*` (= either);
 * - host: `*`, `*.example.org` (the domain and its subdomains) or an exact host, optionally
 *   `:<port>` or `:*`;
 * - path: from `/`, where `*` matches any run of characters (also across `/`).
 */
const PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\d{1,5}|\*))?(\/.*)$/i;

export function isUrlPattern(pattern: string): boolean {
  return PATTERN.test(pattern);
}

export function urlPatternMatches(pattern: string, url: string | undefined | null): boolean {
  const m = PATTERN.exec(pattern);
  if (!m || !url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.slice(0, -1);
  if (scheme !== 'http' && scheme !== 'https') return false;
  const [, wantScheme, wantHost, wantPort, wantPath] = m as unknown as [
    string,
    string,
    string,
    string | undefined,
    string,
  ];
  if (wantScheme !== '*' && wantScheme.toLowerCase() !== scheme) return false;
  const host = parsed.hostname.toLowerCase();
  const h = wantHost.toLowerCase();
  if (h !== '*') {
    if (h.startsWith('*.')) {
      const base = h.slice(2);
      if (host !== base && !host.endsWith(`.${base}`)) return false;
    } else if (host !== h) return false;
  }
  const port = parsed.port || (scheme === 'https' ? '443' : '80');
  if (wantPort === undefined) {
    // No port in the pattern = the scheme's default port only; `:*` = any.
    if (parsed.port !== '') return false;
  } else if (wantPort !== '*' && wantPort !== port) return false;
  const glob = new RegExp(`^${wantPath.split('*').map(escapeRegExp).join('.*')}$`);
  return glob.test(parsed.pathname + parsed.search);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher(value: unknown, where: string): Matcher {
  const src = obj(value, where);
  onlyKeys(src, ['urls', 'fingerprint'], where);
  const out: Matcher = {};
  if (src.urls !== undefined) {
    out.urls = arr(src.urls, `${where}.urls`, 1, 20).map((p, i) => {
      const pattern = str(p, `${where}.urls[${i}]`, 300);
      if (!isUrlPattern(pattern))
        fail(`${where}.urls[${i}]`, `"${pattern}" is not a match pattern like https://*.example.org/*`);
      return pattern;
    });
  }
  if (src.fingerprint !== undefined) {
    out.fingerprint = arr(src.fingerprint, `${where}.fingerprint`, 1, 10).map((c, i) => {
      const at = `${where}.fingerprint[${i}]`;
      const check = obj(c, at);
      onlyKeys(check, ['find', 'meta'], at);
      if ((check.find === undefined) === (check.meta === undefined))
        fail(at, 'needs exactly one of find, meta');
      if (check.find !== undefined) return { find: query(check.find, `${at}.find`) };
      const meta = parseMetaQuery(check.meta);
      if (typeof meta === 'string') fail(`${at}.meta`, meta);
      return { meta };
    });
  }
  if (!out.urls && !out.fingerprint) fail(where, 'needs urls, fingerprint or both');
  return out;
}

function param(value: unknown, where: string): RecipeParam {
  const src = obj(value, where);
  onlyKeys(src, ['name', 'type', 'description', 'required'], where);
  const name = str(src.name, `${where}.name`, 40);
  if (!PARAM_NAME.test(name)) fail(`${where}.name`, 'must look like "text" or "commentText"');
  if (src.type !== 'string') fail(`${where}.type`, 'must be "string" (the only type there is)');
  if (typeof src.required !== 'boolean') fail(`${where}.required`, 'must be true or false');
  return {
    name,
    type: 'string',
    description: str(src.description, `${where}.description`, 500),
    required: src.required,
  };
}

function step(value: unknown, where: string, params: Set<string>): Step {
  const src = obj(value, where);
  const action = src.action;
  if (typeof action !== 'string' || !(STEP_ACTIONS as readonly string[]).includes(action))
    fail(`${where}.action`, `must be one of ${STEP_ACTIONS.join(', ')}`);
  const a = action as StepAction;
  onlyKeys(src, [...COMMON_STEP_KEYS, ...STEP_KEYS[a]], where);
  const id = str(src.id, `${where}.id`, 40);
  if (!STEP_ID.test(id)) fail(`${where}.id`, 'must look like "open-editor"');
  const base: StepBase = { id };
  if (src.note !== undefined) base.note = str(src.note, `${where}.note`, 300);
  if (src.requiresExplicitRequest !== undefined) {
    if (typeof src.requiresExplicitRequest !== 'boolean')
      fail(`${where}.requiresExplicitRequest`, 'must be a boolean');
    if (src.requiresExplicitRequest) base.requiresExplicitRequest = true;
  }
  switch (a) {
    case 'find':
    case 'click':
      return { ...base, action: a, target: query(src.target, `${where}.target`) };
    case 'submit':
      // A submit publishes something (a comment, a saved description). Running it must be the
      // person's explicit wish, and the recipe has to say so — not rely on the runner guessing.
      if (base.requiresExplicitRequest !== true)
        fail(where, 'a submit step must be marked "requiresExplicitRequest": true');
      return {
        ...base,
        requiresExplicitRequest: true,
        action: 'submit',
        target: query(src.target, `${where}.target`),
      };
    case 'fill': {
      const name = str(src.param, `${where}.param`, 40);
      if (!params.has(name)) fail(`${where}.param`, `"${name}" is not a declared param`);
      const out: Step = {
        ...base,
        action: 'fill',
        target: query(src.target, `${where}.target`),
        param: name,
      };
      if (src.as !== undefined) {
        if (src.as !== 'text' && src.as !== 'html') fail(`${where}.as`, 'must be "text" or "html"');
        out.as = src.as;
      }
      if (src.mode !== undefined) {
        if (src.mode !== 'replace' && src.mode !== 'append')
          fail(`${where}.mode`, 'must be "replace" or "append"');
        out.mode = src.mode;
      }
      return out;
    }
    case 'wait': {
      const target = src.for === 'load' ? 'load' : query(src.for, `${where}.for`);
      const out: Step = { ...base, action: 'wait', for: target };
      if (src.timeoutMs !== undefined)
        out.timeoutMs = int(src.timeoutMs, `${where}.timeoutMs`, 100, MAX_WAIT_MS);
      return out;
    }
    case 'read': {
      const out: Step = { ...base, action: 'read' };
      if (src.maxChars !== undefined) out.maxChars = int(src.maxChars, `${where}.maxChars`, 100, 200_000);
      return out;
    }
    case 'outline': {
      const out: Step = { ...base, action: 'outline' };
      if (src.maxItems !== undefined) out.maxItems = int(src.maxItems, `${where}.maxItems`, 10, 2_000);
      return out;
    }
    case 'checkpoint':
      return { ...base, action: 'checkpoint', message: str(src.message, `${where}.message`, 500) };
  }
}

/**
 * Validate a recipe. Returns the recipe, or the reason it is refused (naming the offending path,
 * e.g. `steps[2].target: role must be one of …`).
 */
export function parseRecipe(raw: unknown): Recipe | string {
  try {
    let size: number;
    try {
      size = JSON.stringify(raw)?.length ?? 0;
    } catch {
      return 'recipe: not plain JSON data';
    }
    if (size > MAX_RECIPE_BYTES) return `recipe: larger than ${MAX_RECIPE_BYTES} bytes`;
    const src = obj(raw, 'recipe');
    onlyKeys(src, TOP_KEYS, 'recipe');
    const id = str(src.id, 'id', 101);
    if (!ID.test(id)) fail('id', 'must look like "<app>/<task>", e.g. "openproject/add-comment"');
    const version = str(src.version, 'version', 20);
    if (!VERSION.test(version)) fail('version', 'must look like "1.0.0"');
    const matchRaw = Array.isArray(src.match) ? src.match : [src.match];
    const match = arr(matchRaw, 'match', 1, 10).map((m, i) =>
      matcher(m, Array.isArray(src.match) ? `match[${i}]` : 'match'),
    );
    const params = arr(src.params ?? [], 'params', 0, MAX_PARAMS).map((p, i) => param(p, `params[${i}]`));
    const names = new Set<string>();
    for (const p of params) {
      if (names.has(p.name)) fail('params', `"${p.name}" is declared twice`);
      names.add(p.name);
    }
    const steps = arr(src.steps, 'steps', 1, MAX_STEPS).map((s, i) => step(s, `steps[${i}]`, names));
    const ids = new Set<string>();
    for (const s of steps) {
      if (ids.has(s.id)) fail('steps', `step id "${s.id}" is used twice`);
      ids.add(s.id);
    }
    return {
      id,
      title: str(src.title, 'title', 100),
      description: str(src.description, 'description', 2000),
      version,
      match,
      params,
      steps,
    };
  } catch (err) {
    if (err instanceof Invalid) return err.message;
    throw err;
  }
}

export type RunParams = Record<string, string>;

/**
 * Check the params of a run against the recipe: every required one present, no unknown ones,
 * every value a string within bounds. Returns the reason on failure.
 */
export function checkRunParams(recipe: Recipe, raw: unknown): RunParams | string {
  const given = raw ?? {};
  if (typeof given !== 'object' || Array.isArray(given)) return 'params must be an object';
  const declared = new Map(recipe.params.map((p) => [p.name, p]));
  const out: RunParams = {};
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (!declared.has(key))
      return `unknown param "${key}"; ${recipe.id} takes ${recipe.params.map((p) => p.name).join(', ') || 'none'}`;
    if (typeof value !== 'string') return `param "${key}" must be a string`;
    if (value.length > MAX_PARAM_CHARS) return `param "${key}" is longer than ${MAX_PARAM_CHARS} characters`;
    out[key] = value;
  }
  for (const p of recipe.params)
    if (p.required && !(p.name in out)) return `missing required param "${p.name}"`;
  return out;
}

/** The URL half of a matcher. `null` = this matcher has no URL part (only a fingerprint decides). */
export function urlsMatch(matcher: Matcher, url: string | undefined | null): boolean | null {
  if (!matcher.urls) return null;
  return matcher.urls.some((p) => urlPatternMatches(p, url));
}
