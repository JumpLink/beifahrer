/**
 * Every string the person reads goes through here, English and German; what an AGENT reads stays
 * English (ADR 0008) and never passes through this file.
 *
 * Two catalogs, one set of keys: a key present in one and missing in the other falls back to English
 * at run time and is a failure in the tests, so a German window never shows a raw key.
 */

import de from '../locales/de.json' with { type: 'json' };
import en from '../locales/en.json' with { type: 'json' };

export type Locale = 'en' | 'de';
export type Key = keyof typeof en;
export type Translate = (key: Key, params?: Record<string, string | number>) => string;

export const CATALOGS: Record<Locale, Record<string, string>> = { en, de };

/**
 * The first language the person prefers that we have a catalog for. `candidates` are in preference
 * order and look like `de_DE.UTF-8`, `de-AT`, `de` or `C`; English when none matches.
 */
export function pickLocale(candidates: readonly string[]): Locale {
  for (const raw of candidates) {
    const language = raw.split(/[._@:-]/)[0]?.toLowerCase();
    if (language === 'de' || language === 'en') return language;
  }
  return 'en';
}

export function createTranslate(locale: Locale): Translate {
  return (key, params = {}) => {
    const text = CATALOGS[locale][key] ?? CATALOGS.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
  };
}
