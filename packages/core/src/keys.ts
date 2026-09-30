/**
 * What a key press is, as DATA, before it reaches a page (issue: keyboard without a keyboard).
 *
 * Pure, so the extension, the page agent and the tests agree on one list of names without a
 * browser — the same reason `find.ts` and `evaluate.ts` are pure.
 *
 * A key is named the way the UI Events standard names it (`Enter`, `ArrowDown`, `F5`), optionally
 * with modifiers joined by `+` (`Shift+Tab`, `Control+Enter`). A single character is itself a key:
 * `page_press` with `a` is what a person pressing A does, not what typing the letter into a field
 * does — the difference matters and is spelled out in the method's doc comment.
 */

/** Longest a key specification may be. `Control+Shift+Alt+Meta+ArrowDown` is 37. */
export const MAX_KEY_CHARS = 64;

/** How often one call may repeat a press. Ten is already a held key. */
export const MAX_KEY_TIMES = 20;

export const MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;

export type Modifier = (typeof MODIFIERS)[number];

/**
 * The named keys, with the `code` each one carries. A `code` is the physical key, so a German
 * QWERTZ keyboard's `y` still reports `KeyY` — which is what a page's shortcut handler compares
 * against. `Space` is the one place where the `key` and the `code` differ by name.
 */
export const NAMED_KEYS: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Space: 'Space',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
};

/**
 * The same keys, as the numbers a pre-2017 handler compares against. Fixed for every key above,
 * which is what makes carrying it honest: a table with holes would send a wrong number, and a wrong
 * number is worse than none — the page would take a shortcut the person never pressed.
 */
const KEY_CODES: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
};

export interface KeySpec {
  /** The name as written, for the confirm window and for the result. */
  spec: string;
  /** The `key` a KeyboardEvent carries. */
  key: string;
  /** The `code`, where the key has a well-known one. Absent for a printable character. */
  code?: string;
  /**
   * The deprecated `keyCode`, for a page's handler that still compares numbers.
   *
   * It is deprecated and the standard says a new site must not read it — but "must not" is not
   * "no site does", and a page that compares `e.keyCode === 13` for Enter would silently ignore a
   * press beifahrer sent. Carrying it costs one number per key and makes those pages work. The
   * table is fixed and complete for every key beifahrer can name, so it is never a guess.
   */
  keyCode: number;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** For a printable character: what a person typing it puts into the field. */
  text?: string;
}

const KEYS = new Set(Object.keys(NAMED_KEYS));

/**
 * A modifier's name on a KeyboardEvent is not always its field name: the standard calls the
 * property `ctrlKey` and everyone writes `Control`, so the two are paired here rather than derived
 * by lowercasing — `Control` would otherwise set a `control` flag that no event ever reads, and the
 * page would receive `Control+Tab` as a bare Tab.
 */
const MODIFIER_FIELDS = [
  { name: 'Alt', prop: 'alt' },
  { name: 'Control', prop: 'ctrl' },
  { name: 'Meta', prop: 'meta' },
  { name: 'Shift', prop: 'shift' },
] as const satisfies readonly { name: string; prop: 'alt' | 'ctrl' | 'meta' | 'shift' }[];

/**
 * Parse what the agent asked for, or say why it cannot be a key.
 *
 * Fail closed on the two things that would make a press mean something other than what it says:
 * an empty name, and a name with characters no key carries. `Shift+a` and `a` differ only in the
 * `key` value, and both are allowed — a page's handler may check either.
 */
export function parseKeySpec(raw: unknown): KeySpec | string {
  if (typeof raw !== 'string') return 'key must be a string, e.g. "Enter" or "Control+a"';
  const spec = raw.trim();
  if (spec === '') return 'key must not be empty';
  if (spec.length > MAX_KEY_CHARS) return `key is ${spec.length} characters, over the ${MAX_KEY_CHARS} limit`;

  // `+` is a key of its own, so it cannot also be the separator without a way to tell the two
  // apart. `Shift++` therefore means shift plus the plus key, and a bare `+` is the plus key with
  // nothing in front of it — the split below produces empty parts for both, which are consumed
  // here rather than reported as an empty modifier.
  const parts = spec === '+' ? ['+'] : spec.split('+');
  const name = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
  const modifierNames = parts.slice(0, -1).filter((part) => part !== '');

  const spec2: KeySpec = {
    spec,
    key: name,
    keyCode: 0,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
  for (const part of modifierNames) {
    const field = MODIFIER_FIELDS.find((f) => f.name.toLowerCase() === part.toLowerCase());
    if (field === undefined) return `"${part}" is not a modifier — use one of ${MODIFIERS.join(', ')}`;
    spec2[field.prop] = true;
  }

  // A modifier with nothing to apply it to. Said plainly, because "Control is not a key" sends an
  // agent hunting for a key called Control instead of at the one it left out — and a bare modifier
  // presses nothing at all, which is exactly the call that must not answer "done".
  if (MODIFIER_FIELDS.some((f) => f.name.toLowerCase() === name.toLowerCase()))
    return `"${name}" is a modifier on its own — name the key to press with it, e.g. ${name}+a`;

  if (KEYS.has(name)) {
    spec2.code = NAMED_KEYS[name];
    spec2.keyCode = KEY_CODES[name] ?? 0;
    // A named key writes nothing into a field; Space is the exception the spec itself makes.
    if (name === 'Space') spec2.text = ' ';
    // Shift changes what a letter key REPORTS, and for a named key too: Shift+Tab is still Tab on
    // the `code`, so the only thing shift does is sit in the modifier flags.
    return spec2;
  }
  if (name.length > 1)
    return `"${name}" is not a key — name it (${Object.keys(NAMED_KEYS).slice(0, 6).join(', ')}, …) or send a single character`;
  if (name < ' ') return `"${name}" is not a key a person can press`;

  // A printable character. Its `code` is the physical key, which only the letters and digits have
  // a name for; a page that needs one for punctuation reads `event.key` anyway.
  const upper = name.toUpperCase();
  if (/^[A-Z]$/.test(upper)) spec2.code = `Key${upper}`;
  else if (/^[0-9]$/.test(name)) spec2.code = `Digit${name}`;
  spec2.keyCode = upper.codePointAt(0) ?? 0;
  spec2.text = name;
  return spec2;
}

/** `times`, bounded. Ten is already a key held down; a hundred is a loop with a page as its excuse. */
export function parseKeyTimes(raw: unknown): number | string {
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 'times must be a whole number of at least 1';
  if (n > MAX_KEY_TIMES) return `times is ${n}, over the ${MAX_KEY_TIMES} limit`;
  return n;
}
