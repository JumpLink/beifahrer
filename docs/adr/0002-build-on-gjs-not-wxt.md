# 0002 — Build the extension on GJS with gjsify, not with WXT

- **Status:** accepted. Supersedes the build half of ADR 0001.
- **Date:** 2026-09-25

## Context

0.1 was built with [WXT](https://wxt.dev). WXT runs on Vite, and Vite runs on Node, so a machine
that builds beifahrer needed two JavaScript runtimes: GJS for the bridge, Node for the extension.
The goal is one.

Getting WXT itself to run on GJS was measured and turned down as the path for this project.
Bundling its CLI with `gjsify build --app gjs` already fails at bundle time: two parse errors in
dependencies, and `Cannot assign to import 'console'` from a dependency that reassigns the global.
Behind that come Vite 8's rolldown as a native N-API binary, runtime TypeScript loading of
`wxt.config.ts` through jiti's module hooks, workers and file watchers. Each of those is gjsify
core work. That work is worth doing in gjsify (running Node bins on GJS is being built there as a
general feature), but it is not something this repository should wait on.

beifahrer used little of WXT: the manifest per browser, three HTML pages, two scripts, zips and
the `browser` global. The `browser` global is four lines plus types, published separately as
`@wxt-dev/browser`.

## Decision

- **Bundling:** `gjsify build --app browser --format iife`, once per script. Content scripts
  injected by file and an MV3 service worker both need a classic script, so every script is an
  IIFE, and the same bundle goes into every target.
- **Manifest:** `extension/manifest.ts`, one function per target. The two flavours differ in five
  keys, and spelling them out is shorter than a conversion layer.
- **Driver:** `extension/scripts/build.ts`, itself bundled and run on GJS. It also writes the zips
  (with `fflate`, pure JS) and the E2E variant (`BEIFAHRER_E2E_SEED` → `.output-e2e/`).
- **Kept:** `@wxt-dev/browser` for the `browser` global and its types. It is a runtime shim, not
  build tooling.

Measured on the switch: both targets build in 5.4 s on GJS. The unit tests (43 on GJS and Node)
and the e2e run (36/36 in headless Chromium and Firefox) pass unchanged against the new bundles.

## Consequences

- No dev server with hot reload. Rebuild with `gjsify workspace beifahrer-extension build` and
  reload the extension; at this size that is seconds.
- The `vite` devDependency, which was only there because `gjsify install` does not install
  required peer dependencies, is gone with WXT.
- Still on Node: the e2e driver (`tests/e2e/browsers.e2e.mjs`) and `web-ext`, which launches
  Firefox with a temporary add-on. Both are test tooling, not the build; moving them is the
  natural first user of gjsify's "run a Node bin on GJS" feature once it lands.
