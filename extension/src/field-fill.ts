/**
 * Putting text into a text field the way a framework's field believes it was typed.
 *
 * A controlled field (React, Fluent UI) keeps its own copy of the value and compares it with the
 * DOM's on the next `input` event. Assigning `el.value = …` goes through the instance's patched
 * setter, so the framework's copy is updated too and it sees "no change": the field shows the text
 * and the form model is still empty. The prototype's native setter bypasses the patch, and the
 * `input` event that follows is then a real difference. Autocompletes and date pickers go one step
 * further and react to KEYS, not to values, so the last character is sent as a key press around its
 * input event (idea from browser-use, `browser_use/ax.py` `type()`, MIT).
 *
 * After the write the field is read back: `stuck` says whether the page kept it. One retry if not.
 * The value itself is never returned or logged: it may be a secret, and equality is the answer.
 */

export interface FieldLike {
  focus(): void;
  dispatchEvent(event: unknown): boolean;
}

/** The browser calls this needs, so the tests can give it a field and a recorder. */
export interface FillEnv<T extends FieldLike> {
  /** The prototype's native `value` setter, not the instance's. */
  setValue(el: T, value: string): void;
  /** What the field holds now. */
  read(el: T): string;
  input(type: 'beforeinput' | 'input', inputType: string, data: string | null): unknown;
  key(type: 'keydown' | 'keypress' | 'keyup', key: string): unknown;
  change(): unknown;
}

export interface Filled {
  /** The page kept what was written. */
  stuck: boolean;
  /** The first write did not stick and a second was made. */
  retried: boolean;
  /** Characters the field holds now. */
  length: number;
}

function write<T extends FieldLike>(el: T, target: string, env: FillEnv<T>): void {
  el.focus();
  if (target === '') {
    el.dispatchEvent(env.input('beforeinput', 'deleteContentBackward', null));
    env.setValue(el, '');
    el.dispatchEvent(env.input('input', 'deleteContentBackward', null));
    el.dispatchEvent(env.change());
    return;
  }
  // By code point: half a surrogate pair is not a key anyone presses.
  const chars = Array.from(target);
  const last = chars.pop() as string;
  const head = chars.join('');
  if (head) {
    el.dispatchEvent(env.input('beforeinput', 'insertText', head));
    env.setValue(el, head);
    el.dispatchEvent(env.input('input', 'insertText', head));
  }
  const key = last === '\n' ? 'Enter' : last;
  el.dispatchEvent(env.key('keydown', key));
  el.dispatchEvent(env.key('keypress', key));
  el.dispatchEvent(env.input('beforeinput', 'insertText', last));
  env.setValue(el, target);
  el.dispatchEvent(env.input('input', 'insertText', last));
  el.dispatchEvent(env.key('keyup', key));
  el.dispatchEvent(env.change());
}

/** Write `target` (the whole new value), read it back, and write once more if it did not stick. */
export function typeInto<T extends FieldLike>(el: T, target: string, env: FillEnv<T>): Filled {
  write(el, target, env);
  let held = env.read(el);
  if (held === target) return { stuck: true, retried: false, length: held.length };
  write(el, target, env);
  held = env.read(el);
  return { stuck: held === target, retried: true, length: held.length };
}

/** The element that has the keyboard, through open shadow roots, or `null`. */
export function deepActive(doc: { activeElement: unknown }): unknown {
  let active = doc.activeElement as { shadowRoot?: { activeElement: unknown } | null } | null;
  for (let depth = 0; active?.shadowRoot?.activeElement && depth < 12; depth++)
    active = active.shadowRoot.activeElement as typeof active;
  return active;
}
