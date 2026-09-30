import { describe, expect, it } from '@gjsify/unit';
import {
  MAX_KEY_CHARS,
  MODIFIERS,
  NAMED_KEYS,
  parseKeySpec,
  parseKeyTimes,
  type KeySpec,
} from '@beifahrer/core';

/** The parsed key, or a failed expectation: a test that reads `spec('Enter').key` is about the key. */
function spec(raw: string): KeySpec {
  const parsed = parseKeySpec(raw);
  if (typeof parsed === 'string') throw new Error(`expected ${raw} to be a key, got: ${parsed}`);
  return parsed;
}

// A key press is the one call an agent makes that the page itself is meant to react to, so what
// lands on the page is the whole content of the call: a wrong `key` is a shortcut that does
// something else, and a wrong `code` is a shortcut the page's handler does not recognise. These
// tests pin both values, and the refusals, which are what keeps a mistyped key from becoming an
// accident.
export default async () => {
  await describe('parseKeySpec', async () => {
    await it('names a key the way the UI Events standard names it', async () => {
      const parsed = parseKeySpec('Enter');
      expect(parsed).toStrictEqual({
        spec: 'Enter',
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
      });
    });

    await it('carries the code of a named key, which is what a shortcut handler compares', async () => {
      for (const [name, code] of Object.entries(NAMED_KEYS)) {
        const parsed = spec(name);
        expect(parsed.key).toBe(name);
        expect(parsed.code).toBe(code);
      }
    });

    await it('reads a single character as a key that also writes text', async () => {
      expect(parseKeySpec('a')).toStrictEqual({
        spec: 'a',
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
        text: 'a',
      });
      expect(parseKeySpec('7')).toStrictEqual({
        spec: '7',
        key: '7',
        code: 'Digit7',
        keyCode: 55,
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
        text: '7',
      });
    });

    await it('has no code for punctuation, and says so by leaving it out', async () => {
      // `event.code` is the PHYSICAL key; only letters and digits have names the standard fixes.
      // Inventing one would make a page's handler read a code no keyboard produces.
      const parsed = spec('.');
      expect(parsed.code).toBe(undefined);
      expect(parsed.text).toBe('.');
    });

    await it('carries the deprecated keyCode, complete for every key it can name', async () => {
      // A page comparing `e.keyCode === 13` must not be the reason a press does nothing. The
      // numbers are fixed and checked here, because a WRONG one is worse than none: the page would
      // take a shortcut nobody pressed.
      expect(spec('Enter').keyCode).toBe(13);
      expect(spec('Escape').keyCode).toBe(27);
      expect(spec('F12').keyCode).toBe(123);
      for (const name of Object.keys(NAMED_KEYS)) expect(spec(name).keyCode).toBeGreaterThan(0);
    });

    await it('reads modifiers in any order and without regard to case', async () => {
      const parsed = spec('control+SHIFT+Tab');
      expect(parsed.ctrl).toBe(true);
      expect(parsed.shift).toBe(true);
      expect(parsed.key).toBe('Tab');
      expect(parsed.code).toBe('Tab');
      expect(spec('Alt+ArrowDown').alt).toBe(true);
      expect(spec('Meta+k').meta).toBe(true);
    });

    await it('says what a bare modifier needs, not that it is unknown', async () => {
      // "Control is not a key" sends an agent looking for a key called Control. The refusal has to
      // name the missing half, because a modifier alone presses nothing.
      const refused = parseKeySpec('Control') as string;
      expect(refused).toContain('modifier on its own');
      expect(refused).toContain('Control+a');
      expect(typeof parseKeySpec('Shift')).toBe('string');
      // …while a modifier WITH a key is a normal key press, whatever it types.
      expect(spec('Shift+a').shift).toBe(true);
      expect(spec('Shift+Enter').key).toBe('Enter');
    });

    await it('knows every modifier it accepts, and no others', async () => {
      expect([...MODIFIERS].sort()).toStrictEqual(['Alt', 'Control', 'Meta', 'Shift']);
      expect(typeof parseKeySpec('Hyper+a')).toBe('string');
    });

    await it('treats a plus as a key of its own, not as an empty part', async () => {
      // `Shift++` is shift plus the plus key. A splitter that dropped the empty part would send
      // the shift modifier with NO key, which is a press of nothing.
      const plus = spec('Shift++');
      expect(plus.key).toBe('+');
      expect(plus.shift).toBe(true);
      expect(spec('+').key).toBe('+');
    });

    await it('writes a space for Space, the one named key that types something', async () => {
      expect(spec('Space').text).toBe(' ');
      expect(spec('Enter').text).toBe(undefined);
    });

    await it('refuses what is not a key at all', async () => {
      for (const raw of ['', '   ', 'Ctrl', '42', 'enter now', 'ArrowLeft+ArrowRight', null, 7, {}])
        expect(typeof parseKeySpec(raw)).toBe('string');
    });

    await it('refuses a key name longer than the cap', async () => {
      expect(typeof parseKeySpec('a'.repeat(MAX_KEY_CHARS + 1))).toBe('string');
      expect(typeof parseKeySpec('Enter')).toBe('object');
    });

    await it('names the key it refused, so the agent can correct itself', async () => {
      const refused = parseKeySpec('Hyper+ArrowLeft') as string;
      expect(refused).toContain('Hyper');
    });
  });

  await describe('parseKeyTimes', async () => {
    await it('is once when the caller did not say', async () => {
      expect(parseKeyTimes(undefined)).toBe(1);
      expect(parseKeyTimes(null)).toBe(1);
    });

    await it('repeats a key a whole number of times', async () => {
      expect(parseKeyTimes(3)).toBe(3);
      expect(parseKeyTimes('5')).toBe(5);
    });

    await it('refuses zero, a negative, a fraction and a loop wearing a key as a disguise', async () => {
      for (const raw of [0, -1, 1.5, 'many', NaN, Infinity]) expect(typeof parseKeyTimes(raw)).toBe('string');
    });
  });
};
