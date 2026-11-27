import { describe, expect, it } from '@gjsify/unit';

import { deepActive, typeInto, type FillEnv } from '../../../../extension/src/field-fill.ts';

// A Fluent/React-like controlled field. The framework patches the INSTANCE's `value` so that a plain
// `el.value = x` updates only the DOM copy and the model never hears of it (it reads back the model
// on the next render, so the text vanishes). The PROTOTYPE's setter is the one that goes through.
interface Field {
  model: string;
  dom: string;
  swallow: number;
  events: string[];
  value: string;
  focused: boolean;
  focus(): void;
  dispatchEvent(e: unknown): boolean;
}

function controlled(
  opts: { swallow?: number; rejectAll?: boolean } = {},
): Field & { proto: (v: string) => void } {
  const el: Field & { proto: (v: string) => void } = {
    model: '',
    dom: '',
    swallow: opts.swallow ?? 0,
    events: [],
    focused: false,
    focus() {
      this.focused = true;
    },
    // The patched instance setter: the DOM changes, the model does not, and the next render restores it.
    set value(v: string) {
      this.dom = v;
      this.dom = this.model;
    },
    get value() {
      return this.dom;
    },
    // The native prototype setter, reached through the env.
    proto(v: string) {
      this.dom = v;
    },
    dispatchEvent(e: unknown) {
      const name = String(e);
      this.events.push(name);
      // On a real `input` the model follows the DOM, unless the field is set to refuse it.
      if (name.startsWith('input:') && opts.rejectAll) this.dom = this.model;
      else if (name.startsWith('input:')) {
        if (this.swallow > 0) {
          this.swallow--;
          this.dom = this.model;
        } else this.model = this.dom;
      }
      return true;
    },
  };
  return el;
}

const env: FillEnv<Field & { proto: (v: string) => void }> = {
  setValue: (el, v) => el.proto(v),
  read: (el) => el.value,
  input: (type, inputType, data) => `${type}:${inputType}:${data ?? ''}`,
  key: (type, key) => `${type}:${key}`,
  change: () => 'change',
};

export default async () => {
  await describe('typeInto', async () => {
    await it('a plain `.value =` does not stick in a controlled field, the native setter does', async () => {
      const plain = controlled();
      plain.value = 'hello';
      expect(plain.model).toBe('');
      const native = controlled();
      const out = typeInto(native, 'hello', env);
      expect(out.stuck).toBe(true);
      expect(native.model).toBe('hello');
    });

    await it('sends the last character as a key press around its input, then change', async () => {
      const el = controlled();
      typeInto(el, 'ab', env);
      expect(el.events).toStrictEqual([
        'beforeinput:insertText:a',
        'input:insertText:a',
        'keydown:b',
        'keypress:b',
        'beforeinput:insertText:b',
        'input:insertText:b',
        'keyup:b',
        'change',
      ]);
      expect(el.focused).toBe(true);
    });

    await it('types a single character with no head, and an empty value as a deletion', async () => {
      const one = controlled();
      typeInto(one, 'x', env);
      expect(one.events[0]).toBe('keydown:x');
      const gone = controlled();
      gone.model = gone.dom = 'old';
      const out = typeInto(gone, '', env);
      expect(out.stuck).toBe(true);
      expect(gone.events.includes('input:deleteContentBackward:')).toBe(true);
    });

    await it('retries once when the first write is reverted, and says so', async () => {
      const el = controlled({ swallow: 2 });
      const out = typeInto(el, 'abc', env);
      expect(out.stuck).toBe(true);
      expect(out.retried).toBe(true);
    });

    await it('reports stuck: false after the retry when the page keeps rejecting it', async () => {
      const el = controlled({ rejectAll: true });
      const out = typeInto(el, 'abc', env);
      expect(out.stuck).toBe(false);
      expect(out.retried).toBe(true);
    });

    await it('never returns the value, only its length', async () => {
      const out = typeInto(controlled(), 'hunter2-secret', env);
      expect(JSON.stringify(out).includes('hunter2')).toBe(false);
      expect(out.length).toBe(14);
    });

    await it('treats an astral character as one key, not half of two', async () => {
      const el = controlled();
      typeInto(el, 'a😀', env);
      expect(el.events.includes('keydown:😀')).toBe(true);
    });
  });

  await describe('deepActive', async () => {
    await it('follows the keyboard through open shadow roots, and stops at a closed one', async () => {
      const inner = { name: 'inner' };
      const mid = { shadowRoot: { activeElement: inner } };
      const host = { shadowRoot: { activeElement: mid } };
      expect(deepActive({ activeElement: host })).toBe(inner);
      const closed = { shadowRoot: null };
      expect(deepActive({ activeElement: closed })).toBe(closed);
      expect(deepActive({ activeElement: null })).toBe(null);
    });
  });
};
