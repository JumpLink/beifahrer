/**
 * The one-time code the person relays (ADR 0020): what may be typed, and into which field.
 *
 * Pure, so that every way the guard can refuse is a unit test. The extension asks these two
 * functions before `page.enterCode` writes anything; the page agent holds no second copy of the
 * rules. Nothing here ever puts the code into a message: a refusal names the rule, not the value.
 */

/** What every log, result and error shows in place of a code. */
export const REDACTED_CODE = '••••';

const CODE = /^[0-9A-Za-z]{4,10}$/;

/** The code to type, or the reason it is refused. The reason never contains the value. */
export function parseOneTimeCode(raw: unknown): { code: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'code must be a string' };
  if (!CODE.test(raw)) return { error: 'code must be 4 to 10 characters, letters and digits only' };
  return { code: raw };
}

/** What the page agent reads off a field. Every string is untrusted page text. */
export interface CodeFieldFacts {
  /** The element's tag, lowercase. Only `input` qualifies. */
  tag: string;
  /** `input.type`, lowercase; empty for a plain text input. */
  type: string;
  autocomplete: string;
  inputmode: string;
  /** name, id, placeholder, aria-label and the label text, joined: everything a person would read. */
  words: string;
}

const TEXTUAL = new Set(['', 'text', 'tel', 'number', 'search']);
// A field that asks for a secret of the person's own is never a code field, whatever else it says.
const SECRET_WORDS = /(^|[^a-z])(pin|passwort|password|kennwort|passwd)([^a-z]|$)/i;
const NOT_A_CODE = /(post|zip|bar|promo|country|area|gutschein|coupon|voucher)-?\s?code|\bplz\b/i;
const CODE_WORDS = /code|einmal|(^|[^a-z])(tan|otp)([^a-z]|$)/i;

/** Null when the field may take a one-time code, otherwise why not. */
export function refuseCodeField(f: CodeFieldFacts): string | null {
  if (f.tag !== 'input') return 'a one-time code goes into a text input only';
  if (f.type === 'password') return 'password fields are never filled — the person types those';
  if (!TEXTUAL.has(f.type)) return `an input of type "${f.type}" is not a code field`;
  if (SECRET_WORDS.test(f.words) || /current-password|new-password/i.test(f.autocomplete))
    return 'this field asks for a PIN or password, not a one-time code — the person types those';
  if (NOT_A_CODE.test(f.words)) return 'this field asks for another kind of code, not a one-time code';
  const marked =
    /one-time-code/i.test(f.autocomplete) || /^numeric$/i.test(f.inputmode) || CODE_WORDS.test(f.words);
  if (!marked)
    return 'the page does not mark this field as a one-time code (autocomplete="one-time-code", numeric inputmode, or a code/TAN/OTP label)';
  return null;
}

/**
 * Replace every occurrence of a secret in a value, deeply. Strings, arrays and plain objects are
 * walked; anything else passes through. Used for every echoed log.
 */
export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((s) => s.length > 0);
  if (live.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return live.reduce((s, secret) => s.split(secret).join(REDACTED_CODE), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
