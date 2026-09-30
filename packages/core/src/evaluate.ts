/**
 * The bounds of `page.evaluate`: what a script sent by an agent may be, and what may come back out
 * of one. Pure, so the extension, the page agent and the tests all agree without a browser.
 *
 * This is the one place beifahrer runs code the agent supplied, which is why the bounds live here
 * rather than in a handler: they are what keeps one call from filling the bridge or the person's
 * tab, and they are the first thing to check when a script misbehaves.
 *
 * Two worlds, and the difference is the whole risk story (ADR 0012):
 * - `isolated` — the page agent's own world. The DOM is visible, the page's JavaScript objects are
 *   not. This is the default and it covers "click that button and tell me what happened".
 * - `main` — the page's own world, where the site's own objects live. Only where the browser
 *   offers it; the extension answers `unsupported` otherwise rather than pretending.
 */

export type ScriptWorld = 'isolated' | 'main';

export const WORLDS: readonly ScriptWorld[] = ['isolated', 'main'];

/** A script longer than this is refused: it cannot be shown to the person in the confirm window. */
export const MAX_SCRIPT_CHARS = 20_000;

/** What one script may hand back, as JSON text. */
export const MAX_RESULT_CHARS = 64_000;

/** Longest one string inside a result, before the whole budget is considered. */
export const MAX_STRING_CHARS = 2_000;

/** Deepest an object is followed. Past this a result is a summary, not a dump. */
export const MAX_DEPTH = 8;

/** Most entries one array or object contributes. */
export const MAX_ITEMS = 100;

/**
 * Most nodes walked over a WHOLE result, at any nesting. This is the terminator for a structure
 * whose visits grow faster than its size — `let a = [1]; while (…) a = [a, a, a, …]` — which the
 * character budget cannot catch while it is still positive, and a walk that cannot end is a hung
 * tab. Every node also spends from the budget, so in practice the budget gets there first; this is
 * the floor under that, for the case where the two disagree.
 */
export const MAX_NODES = 20_000;

/** First lines of a script the person is shown, so "what will run" is answerable at a glance. */
export const SCRIPT_PREVIEW_CHARS = 400;

export interface EvaluateRequest {
  script: string;
  world: ScriptWorld;
  maxChars: number;
}

const KEYS = new Set(['script', 'world', 'maxChars']);

/**
 * Validate what came in over the wire. Fail closed like every other parser here: an unknown key is
 * an error, never ignored, because a dropped key would mean a script runs with bounds the caller
 * did not ask for.
 */
export function parseEvaluate(raw: unknown): EvaluateRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'params must be an object';
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!KEYS.has(key)) return `unknown key "${key}"`;
  const { script } = src;
  if (typeof script !== 'string' || script.trim() === '')
    return 'script must be a non-empty string — it is the body of a function, so "return" gives a result';
  if (script.length > MAX_SCRIPT_CHARS)
    return `script is ${script.length} characters, over the ${MAX_SCRIPT_CHARS} limit`;
  const world = src.world ?? 'isolated';
  if (!WORLDS.includes(world as ScriptWorld)) return `world must be one of ${WORLDS.join(', ')}`;
  const maxChars = Math.min(Math.max(Number(src.maxChars) || MAX_RESULT_CHARS, 200), MAX_RESULT_CHARS);
  return { script, world: world as ScriptWorld, maxChars };
}

/** The first lines of a script, flattened — what the confirm window and the activity log show. */
export function scriptPreview(script: string): string {
  const flat = script.replace(/\s+/g, ' ').trim();
  return flat.length > SCRIPT_PREVIEW_CHARS ? `${flat.slice(0, SCRIPT_PREVIEW_CHARS - 1)}…` : flat;
}

/**
 * The request out of a whole `page.evaluate` call.
 *
 * `tabId` and `browser` are how the call is ADDRESSED, not what it asks for — the same strip
 * `findQueryOf` does for `page.find`. Everything else goes to the parser untouched, so a key the
 * agent invented is still refused: building the object from the three known keys instead (as an
 * earlier draft did) drops `eval: true` on the floor and runs the script under bounds nobody asked
 * for, which is the one thing `parseEvaluate` exists to prevent.
 */
export function evaluateRequestOf(params: unknown): EvaluateRequest | string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return 'params must be an object';
  const { tabId: _t, browser: _b, ...rest } = params as Record<string, unknown>;
  return parseEvaluate(rest);
}

// --- what comes back ---------------------------------------------------------------------------

export interface Projected {
  /** JSON-safe: a tree of primitives, arrays and plain objects. */
  value: unknown;
  /** Something was left out — a budget ran out, a value could not be represented. */
  truncated: boolean;
}

/** Stands in for anything the projection dropped or could not name. */
export const OMITTED = '[omitted]';

/**
 * What one node may cost in the JSON text, as an UPPER bound: 24 characters is more than any number
 * a double prints, than `true`, than `null`, than a short summary. The budget is only a real cap if
 * the walk never charges less than the text it produces — otherwise a result of many small nodes
 * grows past the number the caller agreed to, and the only thing left is the `truncated` flag, which
 * by then describes a result that was already sent.
 */
const NODE_COST = 24;

/**
 * What a container reserves for the "[omitted]" it leaves in place of the rest: the stand-in, the
 * key that names it and a separator. A container stops as soon as only this much is left, so the
 * marker is always affordable and the total spend never passes the budget it started with.
 */
const MARKER_COST = 32;

/**
 * What is reserved on top of that, for the charges no clipping can shrink: a summary of a depth-
 * limited object, an error's name, a node's own punctuation. Small, fixed, and therefore the only
 * reason a single admitted item can overshoot — so it is set aside rather than discovered later.
 */
const FIXED_RESERVE = 96;

interface Cursor {
  /** Characters left for the WHOLE result. Every node spends; nothing gives any back. */
  budget: number;
  /** Nodes left to walk, at any nesting. See `MAX_NODES`. */
  nodes: number;
  /** How deep we are; past MAX_DEPTH an object is summarised. */
  depth: number;
  /** The objects on the way down, to spot a cycle without calling a repeated value one. */
  path: unknown[];
  truncated: boolean;
}

/** Out of budget, or out of nodes: the walk ends here and the caller leaves a marker. */
function spent(cur: Cursor): boolean {
  return cur.budget <= MARKER_COST + FIXED_RESERVE || cur.nodes <= 1;
}

function charge(cur: Cursor, cost: number): void {
  cur.budget -= cost;
  cur.nodes--;
}

/**
 * One string, clipped to the result's own limit AND to what is left of the budget.
 *
 * The second half is what makes the cap a cap. A container admits one more item while there is
 * still room, and a 2000-character string is a single item: without this, the last item of a result
 * could spend more than the budget had left, and the text would leave the size the caller agreed to
 * — flagged, but already on its way down the bridge. Pass no cursor to clip to the plain limit
 * (a description the walk is about to charge for anyway).
 */
function clip(text: string, cur?: Cursor): { out: string; clipped: boolean } {
  const room = cur ? cur.budget - MARKER_COST - FIXED_RESERVE : MAX_STRING_CHARS;
  const limit = Math.max(0, Math.min(MAX_STRING_CHARS, room));
  if (text.length <= limit) return { out: text, clipped: false };
  return { out: limit > 1 ? `${text.slice(0, limit - 1)}…` : '', clipped: true };
}

function isNode(value: object): boolean {
  // Structural, so this module needs no DOM types: it also runs on GJS and Node, in the tests.
  const v = value as { nodeType?: unknown; tagName?: unknown };
  return typeof v.nodeType === 'number' && typeof v.tagName === 'string';
}

function isView(value: object): boolean {
  const v = value as { length?: unknown; buffer?: unknown; constructor?: { name?: string } };
  return typeof v.length === 'number' && v.buffer !== undefined && typeof v.constructor?.name === 'string';
}

/**
 * An element as something an agent can act on: its tag, its id and what it says. Every string in it
 * is clipped, because the page decides how long a `value` or a `textContent` is.
 */
function describeElement(el: object, cur: Cursor): unknown {
  const node = el as {
    tagName: string;
    id?: string;
    innerText?: string;
    textContent?: string;
    value?: string;
  };
  const out: Record<string, unknown> = { tag: node.tagName.toLowerCase() };
  let cost = 16;
  let clipped = false;
  if (node.id) {
    const id = clip(String(node.id), cur);
    out.id = id.out;
    cost += id.out.length + 5;
    clipped = clipped || id.clipped;
  }
  const text = clip((node.innerText ?? node.textContent ?? '').replace(/\s+/g, ' ').trim(), cur);
  if (text.out) {
    out.text = text.out;
    cost += text.out.length + 9;
  }
  clipped = clipped || text.clipped;
  if (typeof node.value === 'string' && node.value) {
    const value = clip(node.value, cur);
    out.value = value.out;
    cost += value.out.length + 11;
    clipped = clipped || value.clipped;
  }
  if (clipped) cur.truncated = true;
  charge(cur, cost);
  return out;
}

function project(value: unknown, cur: Cursor): unknown {
  if (cur.budget <= 0 || cur.nodes <= 0) {
    cur.truncated = true;
    return OMITTED;
  }
  switch (typeof value) {
    case 'undefined':
      // JSON has no undefined; null is the least surprising stand-in.
      charge(cur, NODE_COST);
      return null;
    case 'boolean':
      charge(cur, NODE_COST);
      return value;
    case 'number':
      // NaN and Infinity are not JSON either — and a script returning them means something.
      charge(cur, NODE_COST);
      return Number.isFinite(value) ? value : String(value);
    case 'bigint': {
      const out = clip(`${value}n`, cur);
      if (out.clipped) cur.truncated = true;
      charge(cur, out.out.length + 2);
      return out.out;
    }
    case 'string': {
      const { out, clipped } = clip(value, cur);
      // A clip is data loss too, and the flag is the whole point: `truncated: false` has to mean
      // "this is the whole answer", or an agent that trusts it fills the gap by guessing.
      if (clipped) cur.truncated = true;
      charge(cur, out.length + 2);
      return out;
    }
    case 'symbol': {
      const out = clip(String(value), cur);
      if (out.clipped) cur.truncated = true;
      charge(cur, out.out.length + 2);
      return out.out;
    }
    case 'function': {
      const out = `[function ${(value as { name?: string }).name || 'anonymous'}]`;
      charge(cur, out.length + 2);
      return out;
    }
    default:
      break;
  }

  const object = value as object;
  if (object === null) {
    charge(cur, NODE_COST);
    return null;
  }
  if (cur.path.includes(object)) {
    cur.truncated = true;
    charge(cur, 13);
    return '[circular]';
  }
  if (cur.depth >= MAX_DEPTH) {
    cur.truncated = true;
    return summarise(object, cur);
  }

  cur.path.push(object);
  cur.depth++;
  try {
    return projectObject(object, cur);
  } finally {
    cur.path.pop();
    cur.depth--;
  }
}

/** Past the depth limit, what an object is rather than what is in it. */
function summarise(object: object, cur: Cursor): unknown {
  if (isNode(object)) return describeElement(object, cur);
  if (Array.isArray(object)) return charged(clip(`[array of ${object.length}]`, cur), cur);
  // The keys are the page's, and a key can be a megabyte long, so each one is cut before they are
  // joined: a summary of a pathological object must not itself build a pathological string.
  const keys: string[] = [];
  try {
    for (const key of Object.keys(object)) {
      if (keys.length === 20) break;
      keys.push(key.length > 40 ? `${key.slice(0, 39)}…` : key);
    }
  } catch (err) {
    return charged(clip(`[unreadable: ${(err as Error).name}]`, cur), cur);
  }
  return charged(clip(`{[object]: ${keys.join(', ')}}`, cur), cur);
}

/** A clipped string as the walk's result: its own characters, charged, and the clip is a loss. */
function charged(clipped: { out: string; clipped: boolean }, cur: Cursor): string {
  if (clipped.clipped) cur.truncated = true;
  charge(cur, clipped.out.length + 2);
  return clipped.out;
}

function projectObject(object: object, cur: Cursor): unknown {
  try {
    if (isNode(object)) return describeElement(object, cur);
    if (object instanceof Error) {
      // Clipped in order against what is left, so a megabyte-long message cannot jump the cap.
      const name = clip(object.name, cur).out;
      cur.budget -= 7; // the braces, the two colons and the comma between the two pairs
      const message = clip(object.message, cur).out;
      charge(cur, 2 + name.length + message.length);
      return { name, message };
    }
    if (Array.isArray(object)) return projectArray(object, cur);
    if (object instanceof Map)
      return projectEntriesOf([...object.entries()].slice(0, MAX_ITEMS), cur, '[Map]');
    if (object instanceof Set)
      return projectEntriesOf([...object.values()].slice(0, MAX_ITEMS), cur, '[Set]');
    if (object instanceof ArrayBuffer) {
      const out = `[ArrayBuffer ${object.byteLength} bytes]`;
      charge(cur, out.length + 2);
      return out;
    }
    if (isView(object)) {
      const view = object as { length: number; constructor: { name: string } };
      // The bytes themselves are never copied: a result is for reading, not for smuggling data out.
      const out = `[${view.constructor.name} of ${view.length}]`;
      charge(cur, out.length + 2);
      return out;
    }
    if (object instanceof Promise) {
      charge(cur, 12);
      return '[Promise]';
    }
    return projectEntries(object as Record<string, unknown>, cur);
  } catch (err) {
    cur.truncated = true;
    const out = `[unreadable: ${(err as Error).name}]`;
    charge(cur, out.length + 2);
    return out;
  }
}

function projectArray(items: readonly unknown[], cur: Cursor): unknown {
  charge(cur, 2); // the brackets
  const out: unknown[] = [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (spent(cur)) {
      cur.truncated = true;
      out.push(OMITTED);
      return out;
    }
    charge(cur, 1); // the comma
    out.push(project(item, cur));
  }
  if (items.length > MAX_ITEMS) {
    cur.truncated = true;
    out.push(`… ${items.length - MAX_ITEMS} more`);
  }
  return out;
}

/** Map and Set share one shape: a named wrapper around a list of already-projected values. */
function projectEntriesOf(items: readonly unknown[], cur: Cursor, label: string): unknown {
  charge(cur, label.length + 6);
  const out: unknown[] = [];
  for (const item of items) {
    if (spent(cur)) {
      cur.truncated = true;
      out.push(OMITTED);
      break;
    }
    charge(cur, 1);
    out.push(project(item, cur));
  }
  return { [label]: out };
}

function projectEntries(source: Record<string, unknown>, cur: Cursor): unknown {
  let keys: string[];
  try {
    // A getter on the page's object can throw or run anything; that is what the try is for.
    keys = Object.keys(source).slice(0, MAX_ITEMS);
  } catch (err) {
    cur.truncated = true;
    const out = `[unreadable: ${(err as Error).name}]`;
    charge(cur, out.length + 2);
    return out;
  }
  const out: Record<string, unknown> = {};
  charge(cur, 2); // the braces
  for (const key of keys) {
    if (spent(cur)) {
      // ONE marker for everything that is left, not one per missing key: a thousand keys past the
      // budget must not cost a thousand times what a dozen of them would.
      cur.truncated = true;
      out[OMITTED] = 'more keys';
      return out;
    }
    charge(cur, key.length + 4); // ,"key":
    let item: unknown;
    try {
      item = source[key];
    } catch (err) {
      cur.truncated = true;
      item = `[throws ${(err as Error).name}]`;
    }
    out[key] = project(item, cur);
  }
  if (keys.length >= MAX_ITEMS) {
    cur.truncated = true;
    out['…'] = 'more keys';
  }
  return out;
}

/**
 * Make a value from a script JSON-safe and bounded, and say whether anything was left out. The
 * agent gets a tree it can read and a flag it must not ignore — a `truncated` result is not the
 * whole answer, and guessing the rest is how an agent invents a number.
 *
 * What the caller gets is a promise about SIZE: the text of `JSON.stringify(value)` never exceeds
 * `maxChars`, because every node charges the JSON text it can produce and charges at least that
 * much. Without the `truncated` flag there is no way for the agent to know; with it, but over the
 * cap, the flag would describe a result the bridge had already refused to send.
 */
export function projectValue(value: unknown, maxChars = MAX_RESULT_CHARS): Projected {
  const cur: Cursor = { budget: maxChars, nodes: MAX_NODES, depth: 0, path: [], truncated: false };
  const projected = project(value, cur);
  const text = (() => {
    try {
      return JSON.stringify(projected) ?? '';
    } catch {
      return null;
    }
  })();
  if (text === null) return { value: '[not representable]', truncated: true };
  if (text.length > maxChars) {
    // The accounting above is meant to make this unreachable. If it ever is, the honest answer is
    // the size and nothing else — a tree that does not fit is the one thing the flag cannot excuse.
    return { value: { note: 'the result was too large to project', chars: text.length }, truncated: true };
  }
  return { value: projected, truncated: cur.truncated };
}

/** An error a script threw, as a message the agent can act on — and the person can recognise. */
export function scriptError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    return `${name}${err.message}`.slice(0, 500);
  }
  return String(err).slice(0, 500);
}
