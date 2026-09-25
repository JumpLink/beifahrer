/**
 * Every string the PERSON reads goes through here: the popup, the options, the confirm window,
 * the in-page pill, the toolbar tooltip. The catalogue is the WebExtension standard,
 * `_locales/<lang>/messages.json` (en is the default), so the browser picks the language and the
 * stores can show a translated listing from the same files.
 *
 * What the AGENT reads (MCP tool descriptions, wire error messages) stays English and never comes
 * through here: it is read by a model, and a prompt that changes with the browser's language is
 * a prompt nobody tested.
 *
 * `MessageKey` is the key set of the English catalogue, as a type only (nothing of the JSON is
 * bundled), so a key that does not exist fails `gjsify tsc`. That other locales have exactly
 * the same keys and placeholders is checked by the build (scripts/locales.ts).
 */

import { browser } from '@wxt-dev/browser';
import type { Feature, Method } from '@beifahrer/core';
import type en from '../_locales/en/messages.json';

export type MessageKey = keyof typeof en;

type Underscored<S extends string> = S extends `${infer A}.${infer B}` ? `${A}_${Underscored<B>}` : S;

/** A message, with its `$1…$n` substitutions. A missing message shows its key, never nothing. */
export function t(key: MessageKey, ...substitutions: (string | number)[]): string {
  const text = browser.i18n.getMessage(key, substitutions.map(String));
  return text || key;
}

/** "1 tab" / "3 tabs". getMessage has no plural rules; one/other covers en and de. */
export function plural(
  base: 'windows' | 'tabs' | 'close_target_window' | 'close_target_tabs',
  count: number,
): string {
  return count === 1 ? t(`${base}_one`) : t(`${base}_other`, count);
}

/** The activity log's words for a method, e.g. `page.read` → "read a page". */
export const methodWords = (method: Method): string =>
  t(`method_${method.replace(/\./g, '_') as Underscored<Method>}`);

export const featureLabel = (feature: Feature): string => t(`feature_${feature}_label`);
export const featureDetail = (feature: Feature): string => t(`feature_${feature}_detail`);

/** The browser's UI language, for dates and times next to translated text. */
export const uiLanguage = (): string => browser.i18n.getUILanguage();

/**
 * Fill the static text of an extension page: `data-i18n="key"` sets the text,
 * `data-i18n-<attr>="key"` the attribute `<attr>` (title, subtitle, label, description, …).
 *
 * Runs BEFORE the Adwaita elements are defined (see src/ui/kit.ts): several of them read their
 * attributes once, when they upgrade — `<adw-toggle>` labels among them.
 */
export function localize(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    // A copy: setting an attribute below adds to the live `attributes` map being walked.
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('data-i18n')) continue;
      const text = t(attr.value as MessageKey);
      if (attr.name === 'data-i18n') el.textContent = text;
      else el.setAttribute(attr.name.slice('data-i18n-'.length), text);
    }
  }
  document.documentElement.lang = uiLanguage();
}
