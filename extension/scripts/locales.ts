/**
 * The build-time check of `_locales/`: a translation that is missing, extra or has other
 * placeholders than English fails the build, in CI and locally alike.
 *
 * `gjsify tsc` already refuses a `t('key')` in TypeScript whose key English lacks (i18n.ts types
 * the keys from en). What it cannot see is the other half, which this checks:
 *   - every locale has exactly English's keys (a missing one would silently show English, an extra
 *     one is a key nobody reads any more),
 *   - every message uses exactly the `$NAME$` placeholders its entry declares, and a translation
 *     declares the same ones as English with the same `$n` (the code passes substitutions by
 *     position),
 *   - every `data-i18n*="key"` in the pages and `__MSG_key__` in the manifest names a key,
 *   - the store listing fits: Chrome Web Store truncates a name after 45 characters and refuses
 *     a description over 132.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Entry {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}
type Catalogue = Record<string, Entry>;

const LIMITS: Record<string, number> = { extName: 45, extDescription: 132 };

function load(root: string, lang: string): Catalogue {
  return JSON.parse(readFileSync(join(root, '_locales', lang, 'messages.json'), 'utf8')) as Catalogue;
}

function placeholderErrors(where: string, entry: Entry): string[] {
  const used = new Set([...entry.message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1]!.toLowerCase()));
  const declared = new Set(Object.keys(entry.placeholders ?? {}).map((k) => k.toLowerCase()));
  const errors: string[] = [];
  for (const name of used)
    if (!declared.has(name)) errors.push(`${where}: $${name}$ has no placeholder entry`);
  for (const name of declared)
    if (!used.has(name)) errors.push(`${where}: placeholder ${name} is never used`);
  return errors;
}

/** Every problem found, one line each; empty when the catalogues are consistent. */
export function checkLocales(root: string, sources: { pages: string[]; manifest: string }): string[] {
  const langs = readdirSync(join(root, '_locales'));
  if (!langs.includes('en')) return ['_locales/en is missing: it is the default_locale'];
  const en = load(root, 'en');
  const errors: string[] = [];
  const keyPattern = /^[A-Za-z0-9_@]+$/;

  for (const [key, entry] of Object.entries(en)) {
    if (!keyPattern.test(key)) errors.push(`en/${key}: a key may hold only A-Z, a-z, 0-9, _ and @`);
    errors.push(...placeholderErrors(`en/${key}`, entry));
  }
  for (const lang of langs.filter((l) => l !== 'en')) {
    const other = load(root, lang);
    for (const key of Object.keys(en)) if (!(key in other)) errors.push(`${lang}: missing ${key}`);
    for (const [key, entry] of Object.entries(other)) {
      if (!(key in en)) {
        errors.push(`${lang}: ${key} is not in en`);
        continue;
      }
      errors.push(...placeholderErrors(`${lang}/${key}`, entry));
      const want = JSON.stringify(en[key]!.placeholders ?? {});
      const got = JSON.stringify(entry.placeholders ?? {});
      if (want !== got) errors.push(`${lang}/${key}: placeholders differ from en (${got} vs ${want})`);
    }
  }
  for (const lang of langs) {
    const catalogue = lang === 'en' ? en : load(root, lang);
    for (const [key, max] of Object.entries(LIMITS)) {
      const text = catalogue[key]?.message ?? '';
      if (text.length > max)
        errors.push(`${lang}/${key}: ${text.length} characters, the stores allow ${max}`);
    }
  }

  for (const page of sources.pages) {
    const html = readFileSync(join(root, page), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g))
      if (!(m[1]! in en)) errors.push(`${page}: data-i18n key ${m[1]} is not in en`);
  }
  for (const m of sources.manifest.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g))
    if (!(m[1]! in en)) errors.push(`manifest: __MSG_${m[1]}__ is not in en`);
  return errors;
}
