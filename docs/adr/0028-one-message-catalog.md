# 0028: One message catalog for the extension and the window

- **Status:** proposed
- **Date:** 2026-11-16
- **Refs:** [#90](https://github.com/JumpLink/beifahrer/issues/90)
- **Relates to:** [0008](0008-ui-on-adwaita-web.md) (extension catalog), [0017](0017-native-desktop-app.md) § 5 (the window has its own catalog)

## Context

A shared word ("Pairing token", "Not connected") has two sources: `extension/_locales/{en,de}/messages.json`
(WebExtension format, read through `browser.i18n`) and `app/locales/{en,de}.json` (flat strings, imported
by `app/src/window/i18n.ts` with `with { type: 'json' }`). ADR 0017 § 5 chose two catalogs on purpose:
the extension's keys are the browser UI's, and app strings put into that file would ship in the extension.
Issue #90 asks whether that still holds.

## Measurements

Taken on `origin/main` (`cf9d6b2`) with a throwaway script.

| Question | Extension | Window |
|---|---|---|
| Keys per language | 243 | 185 |
| Key syntax | `[A-Za-z0-9_@]`, no dots | dotted (`status.ready.title`), no underscores |
| Entries with a placeholder | 29 (39 placeholder uses) | 25 (29 uses) |
| Placeholder syntax | `$NAME$` + a `placeholders` object mapping to positional `$1…$n` | `{name}`, filled by name |
| Plural keys | `_one` / `_other` | `.one` / `.many` (2 families) |
| `description` field | 1 entry | none |
| File size (en) | 19 KB | 14 KB |

**Duplicates (window string against extension string, English):** 16 window keys carry text identical to
an extension key (12 extension keys; the diagram labels are the bulk), 2 more differ only in case or
placeholder syntax (`Legal Notice` / `Legal notice`, `+ {count} more` / `+ $COUNT$ more`). That is 18 of
185 window keys (9.7%). The fuzzy pass (word overlap ≥ 0.7) found nothing more. German: 19 exact matches.
**Drift today: 0** (every English duplicate has the same German text). So the cost is the risk of drift,
not a drift that exists.

**Who checks what today.** The extension build (`extension/scripts/locales.ts`) checks keys, placeholders,
unused keys, banned punctuation and store limits. The window has `app/tests/unit/window/i18n.test.ts`
(same keys, same `{names}`, no empty entry). Neither compares across the two. `gjsify webext listing
--check` validates the metainfo and `docs/store/po` against store limits; it does not read `_locales`.

**Build step.** The window already has one: `window.mjs` is built by `gjsify build`, which bundles the
JSON import. "No build step under GJS" does not apply; both catalogs reach the window only through that
bundle.

## Options

| | A. Generate the window JSON from the extension's `messages.json` | B. Neutral source that generates both | C. Keep two catalogs, add a drift check |
|---|---|---|---|
| Idea | One source in extension format. | One flat file (e.g. `i18n/{en,de}.json`) emits `_locales` and `app/locales`. | A map of shared pairs; a test fails when the texts differ. |
| Build impact | New generator step before the window build; the extension build must filter `app_*` keys out of the shipped `_locales` (ADR 0017 § 5), or the window's 167 own strings ship in the extension. | New generator before both builds; `_locales` becomes a generated, committed or gitignored output; `dev.ts` watch and `cpSync` change. | None. One test, no generator. |
| Risk to the window | Medium: dotted keys must be mapped to underscored ones, `$1` to `{name}`, plurals renamed; `Key` type is derived from the output. | Medium: same conversions, in a new tool both builds depend on. | None. |
| Translators | Edit one file, but in the heavier format (`message` objects, `placeholders`). | One simple file; generated outputs must not be edited. | Two files stay; the check names the pair to fix. |
| Size | About 6 files plus a generator and tests. | About 10 files, a new format and migration of 428 entries. | 1 test file, a ~18-line map. |
| Fixes | Drift for all shared text, by construction. | Drift for all text, by construction. | Drift for the mapped pairs only. |

A cannot avoid a window-only namespace in the extension file without the filter, and the filter is the
exact complexity ADR 0017 § 5 declined. B solves it but replaces the WebExtension catalog that the stores
and `browser.i18n` read, for 18 duplicated strings.

## Proposed decision

Take **C now**, defer A and B until the numbers justify them.

1. Add `app/tests/unit/window/catalog-parity.test.ts`. It holds an explicit map `windowKey → extensionKey`
   for the 18 pairs and reads both extension catalogs. For each pair it asserts equal English and German
   text after normalising placeholders (`$NAME$` and `{name}` to a token) and ignoring case.
2. The test also fails when a window string equals an extension string but is **not** in the map, so a new
   duplicate must be mapped (or consciously reworded). This is the guard against the map going stale.
3. ADR 0017 § 5 stays as written. This ADR adds the check, not a merge.
4. Revisit A/B if the map grows past roughly 40 pairs, or if a third catalog appears (for instance a
   Safari-specific one).

**Smallest first step:** items 1 and 2, in one PR; no product code changes.

## Consequences

- Shared text can still be written twice, but not differently: CI fails on the second copy that disagrees.
- Translators keep two files and two formats; the failing test message names both keys.
- The test reads the extension files from `app/`, a new cross-package path, kept in the test only.
- No build, bundle or runtime change; the extension's `locales.ts` checks stay as they are.

## Open for the person

1. Is C an acceptable answer to #90, or should the issue stay open for A/B?
2. Keep ADR 0017 § 5 (separate catalogs) as the long-term rule?
