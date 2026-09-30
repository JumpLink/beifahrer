/**
 * Refs, and which document they point into (issue #32).
 *
 * A ref is `e12` in the page's own document and `b2e12` inside a frame. The frame number is part of
 * the ref rather than a second parameter, and that is a safety decision, not a formatting one:
 *
 * Each frame runs its OWN page agent with its own ref registry, so `e3` exists once per frame and
 * those are different elements. A ref without a frame part would therefore be ambiguous, and an
 * ambiguous ref in a WRITE is a click on the wrong element — in a frame on another origin, that is a
 * write in the name of a site the person never allowed. Putting the frame in the ref means the agent
 * sees which document it is acting on, and the extension knows which one to route the call to.
 *
 * Pure, so the extension, the tests and the recipes agree without a browser. The extension adds and
 * removes the prefix; a page agent never sees one, because inside a frame `b2e5` is just `e5`.
 */

/** `b` for "frame", so a ref cannot be mistaken for a selector or an id. */
const FRAME_PREFIX = 'b';

/**
 * The frame number in a ref is beifahrer's OWN, assigned 1, 2, 3 … in the order the frames sit on the
 * page — not the browser's. Measured: Firefox numbers a frame `10737418241`, so a ref built from the
 * browser's id is neither short enough to read nor comparable, and the agent is the one reading it.
 * The cap of six digits is therefore slack, not a limit that can be hit (a tab may report 40 frames).
 *
 * Refs count from 1, so `e0` is not a ref. It would address nothing, and a ref that addresses
 * nothing is worth refusing at the door: it means the caller invented it, and an invented ref that is
 * quietly accepted travels all the way to a frame before anything says so.
 */
const REF = /^e[1-9]\d*$/;
const FRAME_REF = /^b([1-9]\d{0,5})e[1-9]\d*$/;

export interface ParsedRef {
  /** Which frame the ref is in. 0 is the page's own document, which has no prefix. */
  frame: number;
  /** The ref as the frame's own agent knows it. */
  local: string;
}

/** Parse a ref, or say why it is not one. Fail closed: an invented ref is never guessed at. */
export function parseRef(raw: unknown): ParsedRef | string {
  if (typeof raw !== 'string' || raw === '')
    return 'ref must look like e12 or b2e12 — take it from page_outline';
  const frame = FRAME_REF.exec(raw);
  if (frame) return { frame: Number(frame[1]), local: raw.slice(frame[1].length + 1) };
  if (REF.test(raw)) return { frame: 0, local: raw };
  return 'ref must look like e12 or b2e12 — take it from page_outline';
}

/** The frame a ref is in, or 0. Callers that only need the routing decision use this. */
export function frameOfRef(raw: string): number {
  const parsed = parseRef(raw);
  return typeof parsed === 'string' ? 0 : parsed.frame;
}

/** Put a frame's ref into the agent's namespace. Frame 0 stays bare, so nothing existing changes. */
export function withFrame(ref: string, frame: number): string {
  if (frame <= 0) return ref;
  const parsed = parseRef(ref);
  if (typeof parsed === 'string') return ref;
  return `${FRAME_PREFIX}${frame}${parsed.local}`;
}

/** Every ref in a chunk of answer text, moved into the frame's namespace. */
export function namespaceRefs(text: string, frame: number): string {
  if (frame <= 0) return text;
  // Two shapes, two patterns: `[e12]` in an outline line and `"e12"` inside JSON. One regex for both
  // would want a backreference for the closing character — and the closing character is NOT the
  // opening one, which is a way to write a pattern that matches nothing at all and looks deliberate.
  // Separate patterns also mean an already-namespaced ref cannot be touched: `[b2e1]` has no `[e`.
  return text
    .replace(/\[e(\d+)\]/g, (_all, n: string) => `[${FRAME_PREFIX}${frame}e${n}]`)
    .replace(/"e(\d+)"/g, (_all, n: string) => `"${FRAME_PREFIX}${frame}e${n}"`);
}

/** The inverse, for a ref the agent handed back: strip the frame part again. */
export function localRef(ref: string): string {
  const parsed = parseRef(ref);
  return typeof parsed === 'string' ? ref : parsed.local;
}
