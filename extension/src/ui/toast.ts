/**
 * Show a toast on the page's `<adw-toast-overlay id="toasts">`. `Adw.ToastOverlay` takes an
 * `Adw.Toast`, as GTK's does, and the class lives in `@gjsify/adwaita-web`, which only `ui.js`
 * may bundle (kit.ts). So `ui.js` publishes the builder with `installToasts()` and the page
 * scripts call it through here: importing `Toast` from `@gjsify/adwaita-core` instead would
 * bundle a second Gio resource registry, which the package refuses at load.
 */

import type { Adw } from '@gjsify/adwaita-web';

export type ToastOptions = { timeout: number; buttonLabel?: string; onAction?: () => void };

const KEY = '__beifahrerShowToast';
type Show = (overlay: Adw.ToastOverlay, text: string, options: ToastOptions) => void;

/** Called by `ui.js`, which owns `Adw.Toast`. */
export function installToasts(Toast: typeof Adw.Toast): void {
  const show: Show = (overlay, text, { timeout, buttonLabel, onAction }) => {
    const toast = new Toast({ title: text, timeout });
    if (buttonLabel && onAction) {
      toast.set_button_label(buttonLabel);
      toast.connect('button-clicked', onAction);
    }
    overlay.add_toast(toast);
  };
  (globalThis as Record<string, unknown>)[KEY] = show;
}

export function showToast(text: string, options: ToastOptions): void {
  const show = (globalThis as Record<string, unknown>)[KEY] as Show;
  show(document.getElementById('toasts') as Adw.ToastOverlay, text, options);
}
