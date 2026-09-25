/**
 * The desktop's accent colour, as the extension keeps and resolves it (core `desktop.ts`).
 *
 * Every bridge reads the accent where it runs and says it in its welcome, and again when it
 * changes. The background remembers the latest one in `storage.local`, so a page opened while no
 * session runs still shows the person's accent. Pages (ui/accent.ts) and the in-page pill resolve
 * what to paint with `chooseAccent`.
 */

import { browser } from '@wxt-dev/browser';
import { adwaitaAccentBgColor, adwaitaAccentColor } from '@gjsify/adwaita-core';
import { chooseAccent, parseDesktop, type AccentChoice } from '@beifahrer/core';

export const ACCENT_KEY = 'desktopAccent';

/** Background: a bridge said what the desktop's accent is. Unknown values change nothing. */
export async function rememberDesktop(raw: unknown): Promise<void> {
  const { accent } = parseDesktop(raw);
  if (!accent) return;
  const stored = await browser.storage.local.get(ACCENT_KEY);
  if (stored[ACCENT_KEY] !== accent) await browser.storage.local.set({ [ACCENT_KEY]: accent });
}

/** Whether the engine exposes the system accent as the CSS system colour `AccentColor`. */
function systemAccentSupported(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('color', 'AccentColor');
}

export async function loadAccentChoice(): Promise<AccentChoice> {
  const stored = await browser.storage.local.get(ACCENT_KEY);
  return chooseAccent(stored[ACCENT_KEY], systemAccentSupported());
}

/**
 * The fill (`--accent-bg-color`) and the standalone colour (`--accent-color`) for a choice.
 *
 * gjsify gap (unfixed, gjsify#1821): adwaita-web has no way to follow the browser's
 * `AccentColor`, so the `system` branch is a local shim. It derives the standalone colour the way
 * libadwaita's stylesheet does (OkLab L clamped to 0.5 on light, 0.85 on dark), where the engine
 * supports relative colours, and uses the fill unchanged where it does not. Delete it once
 * adwaita-web can do this itself.
 */
export function accentColors(choice: AccentChoice, dark: boolean): { bg: string; fg: string } {
  if (choice.from !== 'system') {
    return { bg: adwaitaAccentBgColor(choice.name), fg: adwaitaAccentColor(choice.name, dark) };
  }
  const derived = `oklab(from AccentColor ${dark ? 'max(l, 0.85)' : 'min(l, 0.5)'} a b)`;
  return { bg: 'AccentColor', fg: CSS.supports('color', derived) ? derived : 'AccentColor' };
}

/**
 * Call `apply` now, whenever a bridge reports another accent, and whenever the colour scheme
 * flips (the standalone colour differs between light and dark). For pages that stay open.
 */
export function followAccent(apply: (choice: AccentChoice) => void): void {
  let current: AccentChoice | null = null;
  const reload = async () => {
    current = await loadAccentChoice();
    apply(current);
  };
  void reload();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ACCENT_KEY]) void reload();
  });
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current) apply(current);
  });
}
