/**
 * The desktop's accent colour, as the extension keeps and resolves it (core `desktop.ts`).
 *
 * Every bridge reads the accent where it runs and says it in its welcome, and again when it
 * changes. The background remembers the latest one in `storage.local`, so a page opened while no
 * session runs still shows the person's accent. Pages (ui/accent.ts) and the in-page pill resolve
 * what to paint with `chooseAccent`.
 */

import { browser } from '@wxt-dev/browser';
import { adwaitaAccentBgColor } from '@gjsify/adwaita-core';
import { chooseAccent, parseDesktop, type AccentChoice } from '@beifahrer/core';

export const ACCENT_KEY = 'desktopAccent';

/**
 * Background: a bridge said what the desktop's accent is — or, by saying none, that it has none.
 * Then the remembered one is forgotten, so a value a bridge once got wrong (GSettings' schema
 * default outside GNOME, bridge desktop.ts) cannot pin the pages to it for good.
 */
export async function rememberDesktop(raw: unknown): Promise<void> {
  const { accent } = parseDesktop(raw);
  const stored = await browser.storage.local.get(ACCENT_KEY);
  if (!accent) {
    if (stored[ACCENT_KEY] !== undefined) await browser.storage.local.remove(ACCENT_KEY);
    return;
  }
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
 * The accent FILL (`--accent-bg-color`) for a choice.
 *
 * `system` is the engine's own `AccentColor` keyword, passed through: this module is bundled into
 * the CONTENT SCRIPT (the in-page pill, `page-indicator.ts`), which cannot ask adwaita-web to
 * follow the system colour — `applySystemAccent` writes `document.documentElement` of the page
 * beifahrer is reading, and it lives in adwaita-web, whose import registers every element and
 * inlines the stylesheet. The three extension PAGES do follow it, through adwaita-web's own
 * `applySystemAccent` (`ui/accent.ts`); this is the pill, a few pixels in a closed shadow root,
 * where the keyword is the whole answer.
 */
export function accentFill(choice: AccentChoice): string {
  return choice.from === 'system' ? 'AccentColor' : adwaitaAccentBgColor(choice.name);
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
