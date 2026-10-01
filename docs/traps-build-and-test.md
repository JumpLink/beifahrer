# Build, test and tooling traps already paid for

Moved out of [AGENTS.md](../AGENTS.md). Two of these change what a green run MEANS, so they are
repeated as one-line warnings there — this file holds the incident.

Companion files: [traps-browser-platform.md](traps-browser-platform.md) ·
[traps-extension-code.md](traps-extension-code.md) · [gjsify-gaps.md](gjsify-gaps.md).

## Two runtimes, two bundles

- **The bridge runs on GJS and on plain Node, and each needs its own bundle** (`build` →
  `beifahrer.gjs.mjs`, `build:node` → `beifahrer.node.mjs`). gjsify routes GJS-only imports per
  `--app` WHILE BUILDING (`gi://` and the built-ins become `@gjsify/node-gi` shims on a Node target,
  `packages/infra/resolve-npm/lib/index.mjs`), so the GJS bundle keeps its `gi://` and a bare `node`
  refuses that scheme. A build difference, not a source one — and for this bridge the Node build has
  no `gi://` left at all, so it needs no native bindings. Linux ships GJS and the releases are built
  and tested there, which is why GJS stays the default; the e2e runs the whole chain on plain `node`
  with `BEIFAHRER_E2E_BRIDGE=node`.

## A green run that was not

- **`gjsify test` reuses `app/dist-test/test.gjs.mjs` when only `packages/core` changed.** The bundler's
  cache is keyed on the entry files, not on what they import, so a change in `packages/core/src` is
  invisible to the tests until the bundle is thrown away: `rm -rf app/dist-test` before believing a
  green run (or a red one). Measured while adding the key table — a refusal message that had been
  edited three lines away was still the old one in the report. Not a beifahrer bug and not worked
  around in the code: it is in [gjsify-gaps.md](gjsify-gaps.md).
  **The test bundle has its own directory (`gjsify.test.outdir: "dist-test"`) for two incidents.**
  When it shared `app/dist`, this `rm` also deleted the bridge bundle the e2e spawns, and every
  scenario then failed with `McpError: -32000 Connection closed`, which reads like a broken bridge.
  And `gjsify ship` carries everything beside the bundle, so the first CI-built `.rpm` carried
  `test.gjs.mjs` + `test.node.mjs` (1.35 MB unpacked, more than the bridge). Do not move it back.
- **`gjsify check` colours its output, so `grep "error TS"` finds NOTHING.** The ANSI codes sit
  *between* `error` and `TS` (`[91merror[0m[90m TS2554:`), so the obvious filter matches zero lines,
  exits 1, and a piped `check | grep … | head` looks exactly like a clean run. Cost: a whole session
  of reading "clean" while `gjsify tsc --noEmit` reported thirteen type errors in `handlers.ts`.
  **Strip the colours first:**
  `gjsify foreach -A check 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' | grep -E "error TS"`, and read the
  command's own exit status rather than the grep's. The same applies to `lint`.
- **`gjsify format` is not the format check** (under GJS it silently skips HTML, because
  oxfmt-native cannot format it — [gjsify#1807](https://github.com/gjsify/gjsify/issues/1807)):
  `node_modules/.bin/oxfmt --check .` is the gate, locally and in CI.
- **`web-ext lint` calls `update_url` an error, and for this project it is not one.** `manifest.ts`
  sets `browser_specific_settings.gecko.update_url`, without which an unlisted (self-distributed)
  add-on never updates itself — the AMO signing path in `sign.sh` is the only thing that makes a
  person install beifahrer, and it makes them do it by hand forever without it. The lint rule
  (addons-linter.js:3559) forbids a **Mozilla-hosted** add-on from naming its own update source; an
  unlisted one is self-hosted by definition, `web-ext sign` never runs the linter at all
  (`util/manifest.js` checks only name, version and id), and `web-ext lint --self-hosted` reports 0
  errors. So **do not "fix" this by deleting the key**: Firefox keeps the `update_url` of the
  INSTALLED version and never re-reads it (only an enterprise `ExtensionSettings` policy can redirect
  one), so deleting it — or moving it — is the one mistake here that cannot be undone for everyone
  who installed that copy. It is `releases/latest/download/updates.json` precisely because that form
  resolves to the newest release on every request while the URL stays fixed, and the ASSET name must
  carry no version for the same reason gjsify ships `cli.gjs.mjs` rather than `cli-0.52.0.mjs`.

## Runtime facts measured on GJS

- **A peer's close code and reason DO reach the bridge on GJS** (measured 2026-09-30, `@gjsify/ws`
  0.52.0): `4404` + reason arrives as `4404` + that reason, `1000` likewise, a socket killed without a
  close frame as `1005` and empty — SECONDS later. So a close code can carry a person's decision
  (`CLOSE.personDisconnected`, issue #28), and a dropped socket is not one to wait on tightly.

## Ports the person is using

- **The person's sessions hold 47813–47822 while you test**, and their Firefox probes that range.
  Unit tests use port 0 or a random range above 50000; the e2e uses 47900 + offsets
  (`BEIFAHRER_E2E_PORT_BASE` shifts a second run on the same machine, whose fixture port would
  clash); the dev browser 47830–47839. Never kill a `beifahrer mcp` you did not start.

## What the e2e can and cannot do headless

- **The person's switches cannot be flipped headless.** The e2e builds the extension five
  times: default features (the `feature_disabled` refusals — tab management, sessions, screenshots,
  page requests and, since ADR 0012, scripts), PR #8's legacy `grants.manageTabs` plus screenshots,
  the `script` switch and `webRequest` (the migration, the full tab-management run, the script run and
  the request log), `paused`, `access`
  (ADR 0010: a seeded "all sites" grant, a blocked site, and the prompt answered through
  `/__beifahrer_e2e/answer?scope=…` and `/end-wide`), and `confirm`
  (issue #5: confirmation NOT silenced, so the window is really opened and answered through
  `/__beifahrer_e2e/confirm?answer=allow|deny`). The first three switch asking on demand off,
  because their refusal checks expect `forbidden` at once, not a prompt nobody answers. A build
  grants what the person would have to grant in the UI — a headless test cannot press Allow on the
  browser's own bubble: `webRequest` via `e2eApiPermissions`, and the screenshot's `<all_urls>`
  via `e2eAllUrls` (both read only by an E2E build, in `scripts/build.ts`). That grant is the
  reason the screenshot's REFUSAL lives in the `confirm` build: the switch on, the grant off, the
  only combination in which the missing-grant refusal is reachable.
- **A confirmation window can only be answered by the person.** So a script run, a fill and a click
  block until the two minutes are up, which would stall the e2e. E2E builds carry hooks
  (`e2e-seed.ts`): a tab on `/__beifahrer_e2e/confirm?answer=allow|deny` answers every open
  confirmation as that person would (never with "remember"), and
  `/__beifahrer_e2e/answer?scope=…` does the same for the access prompts (ADR 0010).
- **The popup's Disconnect cannot be clicked headless.** E2E builds only (`installE2eHooks`,
  e2e-seed.ts) treat a tab on `/__beifahrer_e2e/disconnect?port=N` as that click; a release build
  carries no seed and registers nothing.
- **The e2e sets `XDG_CONFIG_HOME` inside its throw-away profile**, so the person's own
  `~/.config/beifahrer/recipes` never takes part in a test run.