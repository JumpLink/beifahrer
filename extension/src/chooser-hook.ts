/**
 * The page-world half of `page_upload` on a button that opens a file chooser.
 *
 * Some upload buttons own no `<input type=file>` in the DOM: the click handler makes one, calls
 * `input.click()` on it and never attaches it (React/Fluent screenshot uploaders). A content script
 * cannot see that element, and patching a prototype in its isolated world does not touch the page's
 * own. So this one small function runs in the PAGE's world and does a single thing: while the
 * document carries `data-beifahrer-armed`, a `click()` or `showPicker()` on a file input is not
 * forwarded to the browser (no chooser would open without a person) but hands the element over by
 * marking it `data-beifahrer-chooser` and, if it is detached, parking it in a hidden box in the DOM,
 * where the page agent can reach it.
 *
 * It is fixed code, not agent-supplied (the `evaluate` rules do not apply); it takes no input from
 * the agent and reads nothing from the page. Everything in the function body is literal, because
 * Chromium serialises it through `scripting.executeScript({ world: 'MAIN', func })`; Firefox calls
 * it from the content script with `window.wrappedJSObject`, where `exportFunction` makes the
 * replacement callable by the page.
 */

export const CHOOSER_ARMED = 'data-beifahrer-armed';
export const CHOOSER_MARK = 'data-beifahrer-chooser';
export const CHOOSER_BOX = 'data-beifahrer-chooser-box';

export interface HookWindow {
  document: Document;
  HTMLInputElement: { prototype: object };
}

export function installChooserHook(win: HookWindow = window as unknown as HookWindow): void {
  const root = win.document.documentElement;
  if (root.hasAttribute('data-beifahrer-hooked')) return;
  root.setAttribute('data-beifahrer-hooked', '');
  const proto = win.HTMLInputElement.prototype as {
    click: () => void;
    showPicker?: () => void;
  };
  const exporter = (globalThis as { exportFunction?: (f: unknown, target: unknown) => unknown })
    .exportFunction;
  const wrap = <T>(f: T): T => (typeof exporter === 'function' ? (exporter(f, win) as T) : f);
  const swap = (name: 'click' | 'showPicker'): void => {
    const original = proto[name];
    if (typeof original !== 'function') return;
    proto[name] = wrap(function (this: HTMLInputElement) {
      const doc = this.ownerDocument;
      if (this.type === 'file' && doc.documentElement.hasAttribute('data-beifahrer-armed')) {
        this.setAttribute('data-beifahrer-chooser', '');
        if (!this.isConnected) {
          const box = doc.createElement('div');
          box.hidden = true;
          box.setAttribute('data-beifahrer-chooser-box', '');
          box.appendChild(this);
          doc.documentElement.appendChild(box);
        }
        return;
      }
      original.call(this);
    });
  };
  swap('click');
  swap('showPicker');
}
