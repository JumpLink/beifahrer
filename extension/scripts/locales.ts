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
 *     a description over 132,
 *   - every key is still read somewhere: by its name in a source file, or by one of the families
 *     the code builds from a prefix (`DYNAMIC`). A key nobody reads is text nobody maintains,
 *   - the copy keeps the house style: no em or en dash, no exclamation mark and no curly quote
 *     in any message. The pages were rewritten once to lose exactly those (the /unslop pass).
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

/**
 * Keys the code builds instead of naming: `t(\`method_${…}\`)` and friends. Each pattern names the
 * one place that builds it, so a family that loses its builder is found by reading this list.
 */
const DYNAMIC: RegExp[] = [
  /^method_/, // i18n.ts methodWords
  /^feature_[A-Za-z]+_label$/, // i18n.ts featureLabel
  /^(windows|tabs|close_target_window|close_target_tabs)_(one|other)$/, // i18n.ts plural
  /^toolbar_offline_/, // toolbar.ts titleFor
];

/** Characters the UI copy does not use: dashes as punctuation, exclamation marks, curly quotes. */
const BANNED = /[\u2013\u2014!\u201C\u201D\u201E\u2018\u2019]/;

/** The TypeScript files under `dir` (relative to `root`), for the unused-key check. */
export function sourceFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(root, path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

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
export function checkLocales(
  root: string,
  sources: { pages: string[]; manifest: string; code: string[] },
): string[] {
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
    for (const [key, entry] of Object.entries(catalogue)) {
      const bad = entry.message.match(BANNED);
      if (bad)
        errors.push(`${lang}/${key}: "${bad[0]}" is not part of the UI copy (dash, "!" or curly quote)`);
    }
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

  const code = [...sources.pages, ...sources.code].map((file) => readFileSync(join(root, file), 'utf8'));
  code.push(sources.manifest);
  const words = new Set(code.flatMap((text) => text.match(/[A-Za-z0-9_@]+/g) ?? []));
  for (const m of sources.manifest.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) words.add(m[1]!);
  for (const key of Object.keys(en))
    if (!words.has(key) && !DYNAMIC.some((re) => re.test(key)))
      errors.push(`en/${key}: no page or script reads this key any more`);
  return errors;
}
