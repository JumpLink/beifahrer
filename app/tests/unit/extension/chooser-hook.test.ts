import { describe, expect, it } from '@gjsify/unit';

import {
  CHOOSER_ARMED,
  CHOOSER_MARK,
  installChooserHook,
  type HookWindow,
} from '../../../../extension/src/chooser-hook.ts';

class FakeEl {
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  hidden = false;
  isConnected = true;
  type = '';
  ownerDocument!: FakeDoc;
  hasAttribute(n: string) {
    return this.attrs.has(n);
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  appendChild(c: FakeEl) {
    this.children.push(c);
    c.isConnected = true;
  }
}

class FakeDoc {
  documentElement = new FakeEl();
  constructor() {
    this.documentElement.ownerDocument = this;
  }
  createElement() {
    const e = new FakeEl();
    e.ownerDocument = this;
    return e;
  }
}

function setup() {
  const doc = new FakeDoc();
  let native = 0;
  class Input extends FakeEl {
    click() {
      native++;
    }
    showPicker() {
      native++;
    }
  }
  const win = { document: doc, HTMLInputElement: Input } as unknown as HookWindow;
  installChooserHook(win);
  const input = new Input();
  input.ownerDocument = doc;
  input.type = 'file';
  return { doc, input, native: () => native };
}

export default async () => {
  await describe('installChooserHook', async () => {
    await it('passes click through to the browser while the document is not armed', async () => {
      const { input, native } = setup();
      (input as unknown as { click(): void }).click();
      expect(native()).toBe(1);
      expect(input.hasAttribute(CHOOSER_MARK)).toBe(false);
    });
    await it('swallows click and showPicker on a file input while armed, marks and parks a detached one', async () => {
      const { doc, input, native } = setup();
      doc.documentElement.setAttribute(CHOOSER_ARMED, '');
      input.isConnected = false;
      (input as unknown as { click(): void }).click();
      (input as unknown as { showPicker(): void }).showPicker();
      expect(native()).toBe(0);
      expect(input.hasAttribute(CHOOSER_MARK)).toBe(true);
      expect(doc.documentElement.children.length).toBe(1);
      expect(doc.documentElement.children[0]!.children[0]).toBe(input);
    });
    await it('installs once', async () => {
      const { doc } = setup();
      const win = { document: doc, HTMLInputElement: class {} } as unknown as HookWindow;
      installChooserHook(win);
      expect(typeof (win.HTMLInputElement.prototype as { click?: unknown }).click).toBe('undefined');
    });
  });
};
