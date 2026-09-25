# AGENTS.md — beifahrer

Operating guide for AI agents in the **beifahrer** repo. It follows the
[agents.md](https://agents.md/) convention; the human overview is in [README.md](README.md). This
repo is a submodule of **werkstatt**, whose [AGENTS.md](../../AGENTS.md) holds the workspace rules.
This file is the beifahrer-specific layer and wins where the two differ.

## What this is

A WebExtension (Firefox MV2, Chromium MV3, bundled by gjsify on GJS) plus a loopback
bridge exposed as an MCP server. The bridge is a TypeScript app that **runs on GJS via gjsify**,
like postbote and troedler. Together they let an agent use the person's *own* browser under a
per-site policy the person sets in that browser. Why it exists and what else was considered:
[ADR 0001](docs/adr/0001-a-browser-extension-not-a-driven-browser.md).

## Leitplanken (hard rules)

These are not style. Removing one silently changes what this project *is*.

|**The policy is enforced in the extension, never in the bridge.** The bridge is the process the
agent talks to; a gate there is a gate the agent's side controls. `packages/core/src/policy.ts`
decides, and `extension/src/handlers.ts` calls it before *every* page access.
|**Fail closed.** An unknown origin is `none`. A non-http(s) URL has no origin. An unknown method
is refused. A malformed stored policy entry is dropped, not widened. The MCP read-only gate drops
a tool that forgot its annotation.
|**No `evaluate`.** No method runs agent-supplied JavaScript. Every capability is a named method in
`REQUIRED_LEVEL` (policy.ts) with its level, and in `FEATURE_OF` (features.ts) with exactly ONE
feature. Adding a method means adding both there first.
|**Only the person resumes.** Pause (`paused` in storage) refuses EVERY method, `tabs.list` too.
The popup, options, the in-page Stop button and the shortcut set it; only the popup, options and
shortcut clear it. No protocol method may touch it, and a content script may only ever set it
([ADR 0005](docs/adr/0005-the-person-sees-and-stops-the-agent.md)).
|**Check order, in `runMethod` + handlers:** paused → feature → per-site level → host grant →
confirm. `preflight` (core) does the first two before any handler, so none can forget them.
Features are the person's switches, parsed fail-closed; tab management, sessions and screenshots
are off by default. A NEW URL the agent supplies still needs `read`; closing asks first. Sessions
live in the extension's storage, never on the bridge ([ADR 0004](docs/adr/0004-sessions-live-in-the-browser.md)).
|**The person sees the agent.** Toolbar icon (`toolbarLook`, core), popup activity log (host only,
never page text), and the in-page pill in a CLOSED shadow root outside `<body>`, hidden before
every screenshot. Do not make any of them optional.
|**Host access follows the policy.** Host permissions are *optional* and requested per origin when
the person raises that origin's level. A write needs level `write`, the browser's grant for the
origin, and the person's confirmation, unless they switched confirmation off for that origin.
|**Temporary access is temporary** ([ADR 0010](docs/adr/0010-temporary-access-and-asking-on-demand.md)).
"All sites" and a prompt's "For this session" are `Grant`s (policy.ts) in `storage.session`, never
in the stored policy; `decide` checks their end at decision time, and `grants.ts` gives the host
access back when they end (`hostsToRelease`). An explicit rule beats the wildcard, an explicit
`none` blocks every grant and every prompt, and a write only a grant allows ALWAYS confirms.
Session-bound grants name the extension's own id for the connection, never the bridge's.
|**Asking on demand fails closed.** Below the level, `gate` may open the confirm window
(`access-prompt.ts`): not when paused, not for a switched-off feature (preflight refuses first),
not for a blocked site or a non-web page, not when the person switched asking off. One prompt per
site and session; timeout, close or Deny is `forbidden`. The host permission is requested in the
answer's own click.
|**Redact below `read`.** A tab on a `none` origin shows its host only: never title, path or query.
|**Never fill a password field; never switch the person's tab** (screenshots refuse a tab that is not
the active one).
|**Nothing leaves the device.** No telemetry, no remote endpoint. The Firefox manifest declares
`data_collection_permissions: none`, and that must stay true.
|**One connection per agent session** ([ADR 0007](docs/adr/0007-one-connection-per-agent-session.md)).
Each bridge binds its own port of the range (`listenInRange`), and the extension admits every
socket on its own: loopback, an extension Origin in the handshake, the token (constant time), then
the person's dismissal. No bridge relays for another; a hub would bring back #13 (an old session
blocking new methods). The extension only ever builds `ws://127.0.0.1:<port>/` from a port of
the range, and treats a session's label as untrusted text (`cleanSessionLabel`, set as text).
|**Recipes are data and hold no gate** ([ADR 0006](docs/adr/0006-recipes-are-data-run-as-ordinary-calls.md)).
The bridge runs a recipe as ordinary calls (`app/src/recipes/runner.ts`), so the extension checks
every step; the extension never learns what a recipe is. Steps address elements by role + name,
never by ref, selector or code, and `parseRecipe` (core) refuses any key it does not know. A
publishing step is a `submit` with `requiresExplicitRequest: true`. The public `recipes/` holds
generic recipes only: company domains and processes go in the operator's own directory.
|**Fixtures are synthetic.** Never commit a captured page or a screenshot of a real site. What the
extension reads is the person's private data.
|**Every string the PERSON reads goes through i18n; what the AGENT reads stays English**
([ADR 0008](docs/adr/0008-ui-on-adwaita-web.md)). The pages say only what is not normal
([ADR 0009](docs/adr/0009-quiet-pages.md)); the build refuses unused keys and dashes, `!` or curly
quotes in the copy. Pages, confirm window, pill, toolbar tooltip and
any error shown in them: `t('key')` (`extension/src/i18n.ts`) or `data-i18n*` in the HTML, with the
key in EVERY `extension/_locales/*/messages.json` (the build fails otherwise). MCP tool
descriptions and wire error messages are never translated. A new method needs `method_<name>`
(activity words) in every locale, or `gjsify tsc` fails.

## Layout

| Path | Contains | Runs on |
|---|---|---|
| `packages/core` | **Pure, zero deps.** Wire protocol, the port range (`ports.ts`) and the extension's connection table (`connections.ts`), policy, features + pause (`features.ts`), toolbar look, activity log entries, redaction, saved-session model, element queries (`find.ts`), the recipe format + validator (`recipes.ts`) | GJS, Node, browser |
| `app/` | `beifahrer` CLI: `mcp`, `token`, `serve`, `call`, `tool`. The bridge (`src/bridge/`: `bridge.ts`, one per session, `session.ts` port range + session label), MCP tools, recipe runner + sources (`src/recipes/`) | GJS (bundled by gjsify); tests also on Node |
| `extension/` | background, page agent (+ its pill, `src/page-indicator.ts`), popup, options, confirm window (on `@gjsify/adwaita-web`, shared `src/ui/kit.ts` → `ui.js`), `_locales/` (en default, de); `manifest.ts` + `scripts/build.ts` (runs on GJS; `scripts/icons.ts` renders the sparkles icons from `icons/sparkles.svg`) build both targets | browser (build: GJS + GdkPixbuf/librsvg) |
| `recipes/` | Built-in recipes (JSON), bundled into the app via `app/src/recipes/builtin.ts` | data |
| `tests/e2e/` | Full chain in headless Chromium + Firefox | Node driver, GJS app |
| `probes/epiphany/` | The probe that measured Epiphany (ADR 0001 § 3). Re-run it before claiming support | Epiphany |

## Commands

```sh
gjsify install                                  # never npm install
gjsify workspace beifahrer-cli build            # app/dist/beifahrer.gjs.mjs
gjsify workspace beifahrer-cli test             # unit tests on gjs + node
gjsify workspace beifahrer-extension build      # both browser builds
gjsify foreach -A check && gjsify foreach -A lint
node_modules/.bin/oxfmt --check .                # not `gjsify format`: under GJS it skips HTML
node tests/e2e/browsers.e2e.mjs all             # chromium + firefox, each also with several sessions; needs Playwright's Chromium + firefox
```

The werkstatt sandbox kills a long-running **foreground** GJS process (Exit 144). Launch
`beifahrer serve` / `mcp`, and the e2e run that spawns one, with `run_in_background`.

## Traps already paid for

- **Chrome ≥ 137 ignores `--load-extension`.** The e2e needs Chrome for Testing / Playwright's
  Chromium, not the branded browser.
- **Safari's extension service worker hangs on `new WebSocket('ws://127.0.0.1:…')`.** No error, no
  CPU, no later event: every page waiting on the worker stays white, and even the Web Inspector
  console attached to it evaluates nothing. It only bites once a token is set, because only then
  does the worker connect. So `safari-mv3` uses a non-persistent background PAGE
  (`background.scripts`), where the same bundle connects at once. It needs no host permission
  for 127.0.0.1. Measured on Safari 27.0 / macOS 27, 2026-09-25, with beacons to a local HTTP
  server, because the console was dead: skipping only the constructor kept the worker alive.
- **Safari has neither `tabGroups` nor `sessions`.** `capabilities()` leaves out the methods that
  need them (`NEEDS_API` in handlers.ts), so the agent never gets offered a tool the browser
  cannot serve.
- **Firefox's `permissions.request` must be the first `await` in the click handler.** Any earlier
  await ends the user gesture and the request silently fails (see popup/options).
- **The confirm window is a tab too.** `sender.tab` cannot tell it from a content script;
  `sender.url` can (background.ts).
- **MV3 service workers sleep.** Every socket pings every 20 s. With no session connected, a
  30-second alarm (Chromium's minimum) wakes the worker to probe the range again.
- **Chromium's `captureVisibleTab` wants `<all_urls>`.** A per-origin grant is not enough, which is
  why the Screenshots switch in the options page asks the browser for all sites in the same click
  (ADR 0009). Firefox does not even *define*
  `tabs.captureVisibleTab` until `<all_urls>` is granted, so it is looked up per call, never at
  hello time.
- **Firefox ignores the port in a host permission.** It reports `http://127.0.0.1:8080/*` as granted
  by `permissions.contains` and then refuses `executeScript` with "Missing host permission for the
  tab". Grants are therefore per host (`originPattern()`), and the policy, which compares exact
  origins including the port, stays the gate.
- **Firefox will not let an extension's synthetic paste carry data.** The page's listener receives
  the event, but `getData()` returns '' for data an extension set. This is deliberate principal
  isolation, not a bug to fix. Rich-text filling therefore uses paste in Chromium and
  `execCommand` in Firefox, and checks after every step that the text actually landed
  (`fillRich` in page-agent.ts).
- **The person's sessions hold 47813–47822 while you test**, and their Firefox probes that range.
  Unit tests use port 0 or a random range above 50000; the e2e uses 47900 + offsets
  (`BEIFAHRER_E2E_PORT_BASE` shifts a second run on the same machine, whose fixture port would
  clash); the dev browser 47830–47839. Never kill a `beifahrer mcp` you did not start.
- **The popup's Disconnect cannot be clicked headless.** E2E builds only (`installE2eHooks`,
  e2e-seed.ts) treat a tab on `/__beifahrer_e2e/disconnect?port=N` as that click; a release build
  carries no seed and registers nothing.
- **Lazy tabs differ per engine** (from the API docs; the e2e covers the restore, not each
  branch). Firefox creates `discarded: true` tabs with a `title`, but not pinned ones. Chromium
  rejects the key, so its tabs are created and then discarded once the URL has committed
  (`openLazy` in sessions-store.ts). A loading Chromium tab reports its target in `pendingUrl`
  with `url` empty, so tab listings read both.
- **A whole window is closed with `windows.remove`**, not tab by tab, so that the browser's
  recently-closed list holds it as one window (the e2e restores it from there).
- **The person's switches cannot be flipped headless.** The e2e builds the extension four
  times: default features (the `feature_disabled` refusals), PR #8's legacy `grants.manageTabs`
  plus screenshots (the migration, and the full tab-management run), `paused`, and `access`
  (ADR 0010: a seeded "all sites" grant, a blocked site, and the prompt answered through
  `/__beifahrer_e2e/answer?scope=…` and `/end-wide`). The first three switch asking on demand
  off, because their refusal checks expect `forbidden` at once, not a prompt nobody answers.
- **`label.row { display: flex }` beats the `hidden` attribute.** The UA's `[hidden]` rule loses
  to any author `display`, so style.css forces `[hidden] { display: none !important }`. Without it
  the popup showed "Ask me before every change" at level Read.
- **CKEditor 5 and ProseMirror put `role="textbox"` on their contenteditable.** `kindOf` checks
  for a contenteditable host BEFORE the role, so those editors are `richtext` (and a recipe can
  wait for `{ role: "richtext" }`). Measured on OpenProject: the comment box and the
  description are buttons until clicked, and the editor mounts a moment later, hence
  `page.wait`.
- **A recipe file must be listed in `app/src/recipes/builtin.ts`.** The bundle only carries what
  is imported; the `built-in recipes` unit test fails on a file left out.
- **The e2e sets `XDG_CONFIG_HOME` inside its throw-away profile**, so the person's own
  `~/.config/beifahrer/recipes` never takes part in a test run.
- **Headless Chromium takes one start URL.** A second one makes it exit with "Multiple targets are
  not supported in headless mode". The e2e opens further tabs over the DevTools endpoint.
- **No remote client may navigate a tab to an extension page.** Chromium answers `/json/new` with
  ERR_FILE_NOT_FOUND, Firefox's BiDi with "not allowed in this context", and Firefox drops
  `--start-url moz-extension://…`. `tests/e2e/ui-pages.mjs` opens them from the extension's
  service worker (Chromium) and the browser window in BiDi's chrome scope (Firefox).
- **Chromium has component extensions with a `background.js` worker too.** Pick beifahrer's by
  its manifest (`default_locale`), not by the worker's file name.
- **An Adwaita row's `title` attribute is its heading**, not a tooltip; hover text goes on its
  label column, `.adw-action-row-text` in an action row but `.adw-row-text` in a switch row
  (`hoverText`, features.ts: looking for the second only left every action row bare), and a `<adw-switch-row>`
  notifies `notify::active` for a programmatic change too. Renders go through `setQuietly`
  (`src/ui/features.ts`), or redrawing a switch writes the value straight back.

## gjsify gaps met here

Fix them in gjsify, never around them (werkstatt AGENTS.md § Core deps). Found while building
0.1, 2026-09-25:

| Gap | Consumer-side state |
|---|---|
| `gjsify install` does not install required `peerDependencies` (npm ≥ 7 does), and does not prune packages the lockfile no longer lists | no longer hits beifahrer since the WXT build is gone (ADR 0002); a clean `rm -rf node_modules && gjsify install` before trusting a green build |
| `@gjsify/ws` client: `new WebSocket(url, options)` treated as protocols; URL without path fails the handshake | tests use the three-argument form and `…/`. The extension is unaffected (browsers normalise) |
| `@gjsify/ws` server: `connection` passes the raw `Soup.ServerMessage`, no `req.headers` | `verifyClient` gets the Origin on both runtimes and refuses anything but an extension; nothing after the handshake reads it (ADR 0007 removed the agent role that needed it) |
| `@gjsify/ws` server: a taken port carries no `code: 'EADDRINUSE'`, only a localised Gio message | `bindFirstFree` (core) moves on to the next port after *any* bind error, so the missing code costs nothing |
| `gjsify format` under GJS silently skips HTML (oxfmt-native cannot format it) — [gjsify#1807](https://github.com/gjsify/gjsify/issues/1807) | `oxfmt` is called directly, locally and in CI |
| `app/src/frontends/mcp/runtime.ts` is the **third** verbatim copy (postbote, troedler) | extract to a shared `@gjsify/mcp`; until then change all three or none |
| `@gjsify/adwaita-web` 0.52.0 has one entry: it defines every element and inlines its 200 KB stylesheet as a string, so a page cannot import only what it uses (the elements beifahrer uses measured ~45 KB by path) | `ui.js` is 520 KB (104 KB gzip), shared by the three pages; switch to per-element entries when they exist (ADR 0008) |
| `@gjsify/adwaita-web`: row titles/subtitles are `nowrap` + ellipsis, no `title-lines`/`subtitle-lines`; libadwaita wraps by default | `:root .adw-row-subtitle { white-space: normal }` in style.css, marked `gjsify gap (unfixed, …)` |
| `@gjsify/adwaita-web`: the `--font-family` fallback names `Segoe UI` but no macOS face (`system-ui`/`-apple-system`), so macOS falls back to Helvetica | style.css re-declares the stack with both |
| `@gjsify/adwaita-web`: rows have no `tooltip-text`, and `<adw-toggle-group>` no `sensitive` / per-toggle `enabled` | tooltips go on the row's `.adw-row-text`; the level group is hidden, not greyed, on a non-web page |
| `@gjsify/adwaita-web`: no API to follow the browser's `AccentColor` — [gjsify#1821](https://github.com/gjsify/gjsify/issues/1821) | the fallback when no bridge reported the desktop accent is a shim in `extension/src/accent.ts` (`accentColors`), marked `gjsify gap (unfixed, gjsify#1821)` |
| `@gjsify/adwaita-web`: `<adw-switch-row>` replaces its children at upgrade and has no prefix slot (AdwSwitchRow is an AdwActionRow in libadwaita) | `switchRowIcon` (src/ui/features.ts) prepends the icon after upgrade |
| `@gjsify/adwaita-web`: `<adw-toggle>` has no tooltip | the popup sets `title` on each rendered `button.adw-toggle` (popup/main.ts) |
| `@gjsify/adwaita-web`: `<gtk-popover>` knows only the roles `menu` / `listbox`; a popover holding a sentence has no fitting one | `src/ui/info.ts` sets `role="dialog"`, which the element keeps |
| `@gjsify/adwaita-web`: the stylesheet compiles a subset of the icons (no `media-playback-*`, `dialog-information`, `web-browser`, …) | `src/ui/icons.ts` registers the missing ones from `@gjsify/adwaita-icons` via `registerIcon`, in `ui.js` only |
| `@gjsify/adwaita-web`: the `.compact` status page (96 px icon) is libadwaita's size for a sidebar, too large for an empty list in a 360 px popup | `adw-status-page.empty-state` in style.css shrinks it |

## Conventions

- Conventional commits (`feat(extension): …`, `fix(bridge): …`), imperative, subject ≤ 50 chars.
- This repo is a submodule of werkstatt: commit here first, then bump the pointer in the parent.
- All `@gjsify/*` pins are the same exact version.
- Docs in English. Comments explain *why*.
