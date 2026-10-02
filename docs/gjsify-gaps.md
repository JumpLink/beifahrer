# gjsify gaps met here

Fix them in gjsify, never around them (werkstatt AGENTS.md § Core deps). Found while building
0.1, 2026-09-25:

The table moved here out of beifahrer's [AGENTS.md](../AGENTS.md), which keeps the rule and the
pointer. The werkstatt hub is one hop up: `../../AGENTS.md` from this repo's root.

Companion files: [traps-browser-platform.md](traps-browser-platform.md) ·
[traps-extension-code.md](traps-extension-code.md) · [traps-build-and-test.md](traps-build-and-test.md).

**A `@gjsify/*` bump is also when the gap table is re-read.** Every shim a later gjsify fixed names its
PR and sha here, and `git tag --contains <sha>` in `gjsify/gjsify` is the one command that says
whether the release you are about to move to carries it. A shim whose sha is in no tag is not
deletable yet, however old it looks.

| Gap | Consumer-side state |
|---|---|
| `gjsify install` does not install required `peerDependencies` (npm ≥ 7 does), and does not prune packages the lockfile no longer lists | no longer hits beifahrer since the WXT build is gone (ADR 0002); a clean `rm -rf node_modules && gjsify install` before trusting a green build |
| ~~`@gjsify/ws` client: `new WebSocket(url, options)` treated as protocols; URL without path fails the handshake~~ | **GONE at 0.53.0** (gjsify#1809, c2658660c0): the two-argument overload is in the shipped `websocket.d.ts`, the tests call it, and the `…/` in their URLs is no longer load-bearing |
| ~~`@gjsify/ws` server: `connection` passes the raw `Soup.ServerMessage`, no `req.headers`~~ | **GONE at 0.53.0** (same commit): `connection` carries an `IncomingMessage`-shaped `req`, built from the same header read `verifyClient` already used |
| ~~`@gjsify/ws` server: no GC guard, so an unreferenced server stops listening after ~10 s~~ | **GONE at 0.53.0** (same commit): `_activeWebSocketServers`, the `_activeServers` pattern `@gjsify/http` and `@gjsify/net` already use. Measured: a probe that holds nothing but a port number stays reachable for 28 s under heap churn on 0.53.0 and dies at ~8 s on 0.52.0, so the bridge's own `listening` set is gone |
| `@gjsify/ws` server: a taken port carries no `code: 'EADDRINUSE'`, only a localised Gio message | **also fixed in 0.53.0** (same commit, `createNodeError`), and left as it was: `bindFirstFree` (core) moves on to the next port after *any* bind error, so the missing code never cost anything |
| `gjsify test` does not re-bundle when only an imported workspace package changed (`packages/core`), so the run reports a stale bundle — `rm -rf app/dist-test` | the traps list names it; a core change that "did nothing" is this, not a broken test |
| `gjsify format` under GJS silently skips HTML (oxfmt-native cannot format it) — [gjsify#1807](https://github.com/gjsify/gjsify/issues/1807) | **partly GONE at 0.53.0** (gjsify 85d6f185, in v0.53.0…v0.54.0): `gjsify format --check` under GJS now WARNS and names the files the native engine skipped, instead of passing quietly. `--write` still skips them, so `oxfmt` is still called directly, locally and in CI |
| ~~`app/src/frontends/mcp/runtime.ts` is the **third** verbatim copy (postbote, troedler)~~ | **GONE at 0.54.0** (gjsify#1946, dfca62399f: `@gjsify/mcp` ships `applyReadOnlyGate`, `serveStdio` / `serveUntilClosed`, `mcpSuccess` / `mcpError` — this file's two halves, verbatim). **Deliberately not migrated in the bump PR**: dropping it means postbote, troedler and beifahrer move together or the copies drift again, which is its own change with its own review. Until then: change all three or none |
| `@gjsify/adwaita-web` 0.52.0 has one entry: it defines every element and inlines its 200 KB stylesheet as a string, so a page cannot import only what it uses (the elements beifahrer uses measured ~45 KB by path) | `ui.js` is 520 KB (104 KB gzip), shared by the three pages; switch to per-element entries when they exist (ADR 0008) |
| `@gjsify/adwaita-web`: row titles/subtitles are `nowrap` + ellipsis, no `title-lines`/`subtitle-lines`; libadwaita wraps by default | `:root .adw-row-subtitle { white-space: normal }` in style.css, marked `gjsify gap (unfixed, …)` |
| `@gjsify/adwaita-web`: the `--font-family` fallback names `Segoe UI` but no macOS face (`system-ui`/`-apple-system`), so macOS falls back to Helvetica | style.css re-declares the stack with both |
| `@gjsify/adwaita-web`: rows have no `tooltip-text`, and `<adw-toggle-group>` no `sensitive` / per-toggle `enabled` | tooltips go on the row's `.adw-row-text`; the level group is hidden, not greyed, on a non-web page |
| ~~`@gjsify/adwaita-web`: no API to follow the browser's `AccentColor` — [gjsify#1821](https://github.com/gjsify/gjsify/issues/1821)~~ | **GONE at 0.53.0** (gjsify#1827, b9b343c67d): the pages call `applySystemAccent`, which snaps `AccentColor` to the nearest of the nine with libadwaita's own rule. The in-page **pill** keeps the raw keyword on purpose — it is bundled into the CONTENT SCRIPT, where `applySystemAccent` would write the page beifahrer is reading, and adwaita-web's import would register every element there (`accentFill`) |
| ~~`@gjsify/adwaita-core` / `@gjsify/adwaita-app`: no macOS `AppleAccentColor` → `AdwAccentColor` mapping and no reader/watcher for it~~ | **GONE at 0.53.0** (gjsify#1832, 45ff5e6f2e): `adwAccentFromAppleAccentColor` from adwaita-core, `readMacosAccentColor` / `onMacosAccentColorChanged` from `@gjsify/adwaita-app/system-accent`. The GTK-free subpath is what makes it adoptable: the bridge is headless and runs on Node, where the subpath's `gi://Gio` / `gi://GLib` become `@gjsify/node-gi` and the whole `@gjsify/adwaita-app` barrel (Gtk, devtools) never loads |
| `@gjsify/adwaita-web`: `<adw-switch-row>` replaces its children at upgrade and has no prefix slot (AdwSwitchRow is an AdwActionRow in libadwaita) | `switchRowIcon` (src/ui/features.ts) prepends the icon after upgrade |
| `@gjsify/adwaita-web`: `<adw-toggle>` has no tooltip | the popup sets `title` on each rendered `button.adw-toggle` (popup/main.ts) |
| `@gjsify/adwaita-web`: `<gtk-popover>` knows only the roles `menu` / `listbox`; a popover holding a sentence has no fitting one | `src/ui/info.ts` sets `role="dialog"`, which the element keeps |
| `@gjsify/adwaita-web`: the stylesheet compiles a subset of the icons (no `media-playback-*`, `dialog-information`, `web-browser`, …) | `src/ui/icons.ts` registers the missing ones from `@gjsify/adwaita-icons` via `registerIcon`, in `ui.js` only |
| `@gjsify/adwaita-web`: the `.compact` status page (96 px icon) is libadwaita's size for a sidebar, too large for an empty list in a 360 px popup | `adw-status-page.empty-state` in style.css shrinks it |