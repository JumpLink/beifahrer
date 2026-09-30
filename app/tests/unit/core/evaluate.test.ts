import { describe, expect, it } from '@gjsify/unit';
import {
  MAX_DEPTH,
  MAX_RESULT_CHARS,
  MAX_SCRIPT_CHARS,
  MAX_STRING_CHARS,
  OMITTED,
  WORLDS,
  evaluateRequestOf,
  parseEvaluate,
  projectValue,
  scriptError,
  scriptPreview,
} from '@beifahrer/core';

// `page.evaluate` runs the agent's own code in a page (ADR 0012). What can leave a script and come
// back through the bridge is therefore untrusted in both directions: the script is a program the
// person has not read, and its result may be anything the page had in hand. These tests aim at the
// direction that hurts — a result that is unbounded, ambiguous or silently lossy.
export default async () => {
  await describe('parseEvaluate', async () => {
    await it('accepts a plain script, in the isolated world, under the standard cap', async () => {
      const parsed = parseEvaluate({ script: 'return 1' });
      expect(parsed).toStrictEqual({
        script: 'return 1',
        world: 'isolated',
        maxChars: MAX_RESULT_CHARS,
      });
    });

    await it('refuses a missing, empty or non-string script', async () => {
      for (const raw of [{}, { script: '   ' }, { script: 42 }, { script: null }, null, 'return 1', []])
        expect(typeof parseEvaluate(raw)).toBe('string');
    });

    await it('refuses an unknown key rather than dropping it', async () => {
      // Fail closed: a silently dropped key would run the script under bounds nobody asked for.
      const parsed = parseEvaluate({ script: 'return 1', evaluate: true });
      expect(typeof parsed === 'string' && parsed).toContain('evaluate');
    });

    await it('names the worlds it knows, and `main` is one of them', async () => {
      // The handler refuses `main` with a reason (no WebExtension can run agent code in a page's
      // world without defeating its CSP). The parser accepting it keeps the type honest.
      expect(WORLDS).toStrictEqual(['isolated', 'main']);
      expect(parseEvaluate({ script: 'return 1', world: 'main' })).toMatchObject({ world: 'main' });
      expect(typeof parseEvaluate({ script: 'return 1', world: 'page' })).toBe('string');
    });

    await it('clamps the result cap from both sides', async () => {
      expect(parseEvaluate({ script: 'x', maxChars: 1 })).toMatchObject({ maxChars: 200 });
      expect(parseEvaluate({ script: 'x', maxChars: 10 ** 9 })).toMatchObject({
        maxChars: MAX_RESULT_CHARS,
      });
      expect(parseEvaluate({ script: 'x', maxChars: -5 })).toMatchObject({ maxChars: 200 });
    });

    await it('refuses a script too long for the person to read in the window', async () => {
      // ADR 0012: a script nobody can read is not something anyone can consent to, so this is
      // refused before it ever reaches the confirm window.
      const parsed = parseEvaluate({ script: 'a'.repeat(MAX_SCRIPT_CHARS + 1) });
      expect(typeof parsed === 'string' && parsed).toContain(String(MAX_SCRIPT_CHARS));
      expect(typeof parseEvaluate({ script: 'a'.repeat(MAX_SCRIPT_CHARS) })).toBe('object');
    });
  });

  await describe('evaluateRequestOf: a whole call, not just the request', async () => {
    await it('strips the addressing and keeps the request', async () => {
      // `tabId` and `browser` say WHICH tab and WHICH browser, not WHAT to run — the same strip
      // findQueryOf does for page.find.
      expect(evaluateRequestOf({ tabId: 7, browser: 'firefox', script: 'return 1' })).toStrictEqual({
        script: 'return 1',
        world: 'isolated',
        maxChars: MAX_RESULT_CHARS,
      });
    });

    await it('refuses every other key, because building the request by hand would drop it', async () => {
      // The regression this exists for: assembling `{script, world, maxChars}` from the params runs
      // the script under bounds nobody asked for, silently. An unknown key must reach the parser.
      const parsed = evaluateRequestOf({ tabId: 1, script: 'return 1', eval: true });
      expect(typeof parsed === 'string' && parsed).toContain('eval');
      expect(typeof evaluateRequestOf({ tabId: 1, script: 'return 1', maxChar: 10 })).toBe('string');
      expect(typeof evaluateRequestOf({ tabId: 1 })).toBe('string');
      expect(typeof evaluateRequestOf(null)).toBe('string');
      expect(typeof evaluateRequestOf([{ script: 'return 1' }])).toBe('string');
    });
  });

  await describe('scriptPreview', async () => {
    await it('flattens whitespace and caps the length', async () => {
      expect(scriptPreview('const a =\n  1')).toBe('const a = 1');
      const long = scriptPreview('x'.repeat(500));
      expect(long.length).toBe(400);
      expect(long.endsWith('…')).toBe(true);
    });
  });

  await describe('projectValue: what may cross the bridge', async () => {
    await it('passes the JSON primitives through', async () => {
      expect(projectValue(42).value).toBe(42);
      expect(projectValue(true).value).toBe(true);
      expect(projectValue(null).value).toBe(null);
      expect(projectValue('text').value).toBe('text');
    });

    await it('turns the values JSON has no room for into readable text', async () => {
      // Silently dropping these would look like "the script returned nothing".
      expect(projectValue(undefined).value).toBe(null);
      expect(projectValue(Number.NaN).value).toBe('NaN');
      expect(projectValue(Number.POSITIVE_INFINITY).value).toBe('Infinity');
      expect(projectValue(10n).value).toBe('10n');
      expect(projectValue(Symbol('tag')).value).toBe('Symbol(tag)');
    });

    await it('names a function instead of calling it', async () => {
      expect(projectValue(function answer() {}).value).toBe('[function answer]');
      expect(projectValue(() => undefined).value).toBe('[function anonymous]');
    });

    await it('breaks a cycle instead of throwing or hanging', async () => {
      const value: Record<string, unknown> = { name: 'root' };
      value.self = value;
      const { value: out, truncated } = projectValue(value);
      expect(out).toStrictEqual({ name: 'root', self: '[circular]' });
      expect(truncated).toBe(true);
    });

    await it('does not mistake a repeated reference for a cycle', async () => {
      const shared = { id: 1 };
      const { value: out, truncated } = projectValue({ a: shared, b: shared });
      expect(out).toStrictEqual({ a: { id: 1 }, b: { id: 1 } });
      expect(truncated).toBe(false);
    });

    await it('summarises a DOM node by tag, id and text, never wholesale', async () => {
      const node = { nodeType: 1, tagName: 'BUTTON', id: 'save', innerText: 'Save   now', value: undefined };
      expect(projectValue(node).value).toStrictEqual({ tag: 'button', id: 'save', text: 'Save now' });
      expect(projectValue({ nodeType: 1, tagName: 'INPUT', value: 'typed' }).value).toStrictEqual({
        tag: 'input',
        value: 'typed',
      });
    });

    await it('keeps the rest of a result when one getter throws', async () => {
      // A page object can throw from a getter — including code the agent did not write. One such
      // property must not cost the whole result, and must be visible as what it is.
      const hostile = {
        get boom() {
          throw new RangeError('no');
        },
        fine: 1,
      };
      const { value: out } = projectValue(hostile);
      expect(out).toMatchObject({ fine: 1 });
      expect(JSON.stringify(out)).toContain('throws');
    });

    await it('describes Map, Set, typed arrays, buffers and promises instead of expanding them', async () => {
      expect(projectValue(new Map([['a', 1]])).value).toStrictEqual({ '[Map]': [['a', 1]] });
      expect(projectValue(new Set([1, 2])).value).toStrictEqual({ '[Set]': [1, 2] });
      expect(projectValue(new Uint8Array(4)).value).toBe('[Uint8Array of 4]');
      expect(projectValue(new ArrayBuffer(8)).value).toBe('[ArrayBuffer 8 bytes]');
      expect(projectValue(Promise.resolve(1)).value).toBe('[Promise]');
    });

    await it('reports an Error as its name and message', async () => {
      expect(projectValue(new TypeError('bad input')).value).toStrictEqual({
        name: 'TypeError',
        message: 'bad input',
      });
    });

    await it('clips one long string and says that it did', async () => {
      const { value, truncated } = projectValue('x'.repeat(MAX_STRING_CHARS + 500));
      expect(typeof value === 'string' && value.endsWith('…')).toBe(true);
      expect(truncated).toBe(true);
    });

    await it('keeps the whole result inside the budget and marks the rest as dropped', async () => {
      // This is the bound that protects the bridge and the person from one enormous result.
      const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 'v'.repeat(200)]));
      const { value, truncated } = projectValue(wide, 2_000);
      expect(truncated).toBe(true);
      expect(JSON.stringify(value).length).toBeLessThanOrEqual(2_000);
      expect(JSON.stringify(value)).toContain(OMITTED);
    });

    await it('terminates on a shared subtree, whatever the character cost', async () => {
      // The budget alone does not stop this: every entry is a number or an empty array, so it costs
      // almost nothing in characters, while the visits are 100^depth. The node counter is what ends
      // it — and it ends it with `truncated` set, not by running the tab out of memory.
      let shared: unknown = [1];
      for (let i = 0; i < 9; i++) shared = Array.from({ length: 100 }, () => shared);
      const started = Date.now();
      const { value, truncated } = projectValue(shared);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(truncated).toBe(true);
      expect(JSON.stringify(value).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    });

    await it('never lets a structure grow past the budget by being nested', async () => {
      // The specific regression: a container that returned what it spent could nest for ever, so
      // the result's size followed the NESTING instead of what the caller allowed. Eight to the
      // sixth is 262 144 leaves of 400 characters — 100 MB of text, out of a 4 KB cap.
      let amplified: unknown = 'y'.repeat(400);
      for (let i = 0; i < 6; i++) amplified = Array.from({ length: 8 }, () => amplified);
      const started = Date.now();
      const { value, truncated } = projectValue(amplified, 4_000);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(truncated).toBe(true);
      expect(JSON.stringify(value).length).toBeLessThanOrEqual(4_000);
    });

    await it('says so when it clipped a string, so the flag can be trusted', async () => {
      // `truncated: false` has to mean "this is the whole answer". A clip that stayed silent would
      // make the flag a lie, and an agent that trusts it would invent the rest.
      const { value, truncated } = projectValue({ note: 'z'.repeat(MAX_STRING_CHARS + 1) });
      expect(truncated).toBe(true);
      expect((value as { note: string }).note.endsWith('…')).toBe(true);
      // A string that fits is not a clip.
      expect(projectValue({ note: 'z'.repeat(MAX_STRING_CHARS) }).truncated).toBe(false);
      // Neither is an element whose text fits.
      const node = { nodeType: 1, tagName: 'P', innerText: 'short' };
      expect(projectValue({ node }).truncated).toBe(false);
    });

    await it('keeps value a tree even when the text outgrew the budget', async () => {
      // Many short keys: the walk spends, but the JSON text can still exceed the cap. `value` must
      // stay structured — half a JSON string there would be a second way to lie about the shape.
      const manyKeys = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key-number-${i}`, 'v']));
      const { value, truncated } = projectValue(manyKeys, 1_000);
      expect(truncated).toBe(true);
      expect(typeof value).toBe('object');
      expect(Array.isArray(value)).toBe(false);
      expect(() => JSON.stringify(value)).not.toThrow();
    });

    await it('bounds depth, and says so rather than cutting silently', async () => {
      // Inside the bound, the bottom of the structure is still there: the depth limit is a limit,
      // not a reason to drop what fits.
      let deep: Record<string, unknown> = { end: true };
      for (let i = 0; i < MAX_DEPTH - 2; i++) deep = { level: deep };
      const inside = projectValue(deep);
      expect(inside.truncated).toBe(false);
      expect(JSON.stringify(inside.value)).toContain('end');
      // Past it, a summary — flagged, because something WAS left out.
      let deeper: Record<string, unknown> = { end: true };
      for (let i = 0; i < MAX_DEPTH + 4; i++) deeper = { level: deeper };
      const outside = projectValue(deeper);
      expect(outside.truncated).toBe(true);
      expect(JSON.stringify(outside.value)).toContain('object');
    });

    await it('caps an array and counts what it left out', async () => {
      const { value, truncated } = projectValue(Array.from({ length: 150 }, (_, i) => i));
      expect(truncated).toBe(true);
      expect((value as unknown[]).at(-1)).toContain('more');
    });

    await it('always answers JSON, whatever the script returned', async () => {
      for (const raw of [undefined, () => {}, Symbol('x'), 10n, new WeakMap()])
        expect(() => JSON.stringify(projectValue(raw).value)).not.toThrow();
      const huge = projectValue('y'.repeat(MAX_RESULT_CHARS * 2));
      expect(huge.truncated).toBe(true);
      expect(typeof huge.value === 'string' && huge.value.endsWith('…')).toBe(true);
    });
  });

  await describe('scriptError', async () => {
    await it('keeps the name of a thrown error, and bounds the message', async () => {
      expect(scriptError(new TypeError('nope'))).toBe('TypeError: nope');
      expect(scriptError(new Error('plain'))).toBe('plain');
      expect(scriptError('a string')).toBe('a string');
      expect(scriptError('x'.repeat(2000)).length).toBe(500);
    });
  });
};
