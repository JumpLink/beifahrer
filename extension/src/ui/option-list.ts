/**
 * Build a combo row's model from the page scripts.
 *
 * `GjsifyOptionList` lives in `@gjsify/adwaita-core`, which only `ui.js` may bundle (kit.ts): a
 * page script that imports it brings a second Gio resource registry, and the package throws at
 * load (ADR 0116 § 3) — before the script's first line runs, so the page stayed half-rendered with
 * nothing in the UI saying why. So `ui.js` publishes the builder with `installOptionList()` and the
 * page scripts call it through here, the same way as toast.ts.
 */

import type { GjsifyOptionList } from '@gjsify/adwaita-core';

export type Option = { value: string; label: string };

const KEY = '__beifahrerOptionList';
type Make = (options: Option[]) => unknown;

/** Called by `ui.js`, which owns `@gjsify/adwaita-core`. */
export function installOptionList(List: typeof GjsifyOptionList): void {
  (globalThis as Record<string, unknown>)[KEY] = ((options) => List.new(options)) satisfies Make;
}

export function optionList(options: Option[]): ReturnType<typeof GjsifyOptionList.new> {
  return ((globalThis as Record<string, unknown>)[KEY] as Make)(options) as ReturnType<
    typeof GjsifyOptionList.new
  >;
}
