# 0008: The extension's pages are built on @gjsify/adwaita-web

- **Status:** accepted
- **Date:** 2026-09-25

## Context

The popup, the options page and the confirmation window were hand-written HTML with a small
stylesheet of their own. They worked, but they looked like nothing in particular. The person
uses GNOME and asked for them to feel native there; the extension will also ship to the Chrome,
Firefox and Edge stores and be tested on Windows and macOS, so it has to look right everywhere,
not only on GNOME. Translations were asked for at the same time, and both touch every string on
every page.

Options considered:

| Option | Why not |
|---|---|
| Keep the hand-written CSS and restyle it like Adwaita | A second, private copy of Adwaita's look that drifts from the real one. gjsify already maintains that look for the web |
| A general web component library (Shoelace, Material Web, …) | Native on no desktop, and one more dependency family outside the gjsify toolchain the rest of this repository runs on |
| `@gjsify/adwaita-web` | chosen |

## Decision

The three extension pages are built from `@gjsify/adwaita-web` custom elements, pinned to the
same exact version as every other `@gjsify/*` package: `adw-preferences-group`,
`adw-switch-row`, `adw-action-row`, `adw-combo-row`, `adw-expander-row`, `adw-entry-row`,
`adw-password-entry-row`, `adw-spin-row`, `adw-toggle-group` for the site level, `adw-banner`,
`adw-toast-overlay`, `adw-status-page` and `gtk-button` with its `suggested` / `destructive`
styles. Light and dark follow `prefers-color-scheme` through the package's own tokens;
`extension/src/ui/style.css` only lays the elements out.

1. **One shared `ui.js`.** `src/ui/kit.ts` is bundled once and loaded by all three pages as a
   classic script before the page's own. It first translates the page's static markup, then
   imports the package, which defines the elements and injects its stylesheet. The order is
   load-bearing: `<adw-toggle>` labels and a few other attributes are read once, at upgrade.
   The page scripts import the package's *types* only, so the elements are bundled once.
2. **The whole package, measured.** It exports one entry, which defines every element and
   inlines the 200 KB stylesheet as a string, so a page cannot import only the elements it uses.
   `ui.js` is about 520 KB minified (about 104 KB gzip), read from the extension's own files.
   The pages previously loaded 7 to 17 KB. Importing the element modules by path measured about
   45 KB of element code, which is what per-element entry points in the package would save;
   until it has them, the cost is paid once per page open, from local disk.
3. **No font is shipped.** The package names `Adwaita Sans` and leaves the face to the system,
   which GNOME has. Its fallback names `Segoe UI` for Windows but nothing for macOS, so our
   stylesheet adds `system-ui, -apple-system` to the stack. Bundling the faces would add 2.4 MB.
4. **The extension-page CSP holds unchanged** (`script-src 'self'`, no `unsafe-eval`, no inline
   script). The package injects a `<style>` element, which that CSP does not restrict, and uses
   no `eval`. The e2e opens each page as an extension page in Chromium (MV3) and Firefox (MV2)
   and checks that the elements are defined, upgraded and styled, and that Chromium reported no
   CSP violation or exception (`tests/e2e/ui-pages.mjs`).
5. **Every string the person reads is translated; what the agent reads is not.** The catalogue
   is the WebExtension standard, `extension/_locales/<lang>/messages.json` with `en` as
   `default_locale`, so the stores can list the extension in the person's language too. `t()`
   (`src/i18n.ts`) is typed with English's keys, so an unknown key fails `gjsify tsc`; the build
   (`scripts/locales.ts`) fails on a locale with missing, extra or differently-placeheld keys, on
   a `data-i18n` or `__MSG_…__` key that does not exist, and on a store name or description over
   the Chrome Web Store's limits. MCP tool descriptions and wire errors stay English: a model
   reads them, and a prompt that changes with the browser's language is a prompt nobody tested.

## Consequences

- The pages look and behave like libadwaita preferences on GNOME and like a clean, consistent
  settings page elsewhere, in light and dark.
- A bug or gap in the elements is fixed in gjsify, not around it here. Those met while building
  this are listed in AGENTS.md § gjsify gaps, and a temporary local override is marked
  `gjsify gap (unfixed, …)` so it is removed on the next bump.
- The popup opens a 520 KB script it did not need before. Per-element entry points in
  `@gjsify/adwaita-web` would take most of it away without a change here beyond the imports.
- Adding a method now also means adding its activity words (`method_<name>` in every locale),
  or the extension no longer type-checks.
