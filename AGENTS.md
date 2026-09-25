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
|**Redact below `read`.** A tab on a `none` origin shows its host only: never title, path or query.
|**Never fill a password field; never switch the person's tab** (screenshots refuse a tab that is not
the active one).
|**Nothing leaves the device.** No telemetry, no remote endpoint. The Firefox manifest declares
`data_collection_permissions: none`, and that must stay true.
|**Agent peers are admitted no less strictly than extensions** (ADR 0003): loopback, the same token,
`agent-hello`, and NO Origin. `roleAllowed` ties the first frame to the handshake: a web page
always sends an Origin and so can never become an agent; a process without one can never pose as
a browser. The hub relays a peer's call unchanged and adds no gate of its own.
|**Fixtures are synthetic.** Never commit a captured page or a screenshot of a real site. What the
extension reads is the person's private data.

## Layout

| Path | Contains | Runs on |
|---|---|---|
| `packages/core` | **Pure, zero deps.** Wire protocol, policy, features + pause (`features.ts`), toolbar look, activity log entries, redaction, saved-session model | GJS, Node, browser |
| `app/` | `beifahrer` CLI: `mcp`, `token`, `serve`, `call`. The bridge (`src/bridge/`: `bridge.ts` hub, `shared.ts` hub-or-peer election + relay), MCP tools | GJS (bundled by gjsify); tests also on Node |
| `extension/` | background, page agent (+ its pill, `src/page-indicator.ts`), popup, options, confirm window; `manifest.ts` + `scripts/build.ts` (runs on GJS; `scripts/icons.ts` renders the sparkles icons from `icons/sparkles.svg`) build both targets | browser (build: GJS + GdkPixbuf/librsvg) |
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
node tests/e2e/browsers.e2e.mjs all             # chromium, firefox, shared (two MCP sessions); needs Playwright's Chromium + firefox
```

The werkstatt sandbox kills a long-running **foreground** GJS process (Exit 144). Launch
`beifahrer serve` / `mcp`, and the e2e run that spawns one, with `run_in_background`.

## Traps already paid for

- **Chrome ≥ 137 ignores `--load-extension`.** The e2e needs Chrome for Testing / Playwright's
  Chromium, not the branded browser.
- **Firefox's `permissions.request` must be the first `await` in the click handler.** Any earlier
  await ends the user gesture and the request silently fails (see popup/options).
- **The confirm window is a tab too.** `sender.tab` cannot tell it from a content script;
  `sender.url` can (background.ts).
- **MV3 service workers sleep.** The socket pings every 20 s. A one-minute alarm reconnects a worker
  that slept while the bridge was down.
- **Chromium's `captureVisibleTab` wants `<all_urls>`.** A per-origin grant is not enough, which is
  why screenshots are a separate opt-in in the options page. Firefox does not even *define*
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
- **Several agent sessions, one port.** Each session starts its own `beifahrer mcp`; the real
  person usually has one running while you test. Unit tests use port 0 (the election test a random
  high port), the e2e 47902: never 47813, and never kill a `beifahrer mcp` you did not start.
- **Lazy tabs differ per engine** (from the API docs; the e2e covers the restore, not each
  branch). Firefox creates `discarded: true` tabs with a `title`, but not pinned ones. Chromium
  rejects the key, so its tabs are created and then discarded once the URL has committed
  (`openLazy` in sessions-store.ts). A loading Chromium tab reports its target in `pendingUrl`
  with `url` empty, so tab listings read both.
- **A whole window is closed with `windows.remove`**, not tab by tab, so that the browser's
  recently-closed list holds it as one window (the e2e restores it from there).
- **The person's switches cannot be flipped headless.** The e2e builds the extension three
  times: default features (the `feature_disabled` refusals), PR #8's legacy `grants.manageTabs`
  plus screenshots (the migration, and the full tab-management run), and `paused`.
- **`label.row { display: flex }` beats the `hidden` attribute.** The UA's `[hidden]` rule loses
  to any author `display`, so style.css forces `[hidden] { display: none !important }`. Without it
  the popup showed "Ask me before every change" at level Read.
- **Headless Chromium takes one start URL.** A second one makes it exit with "Multiple targets are
  not supported in headless mode". The e2e opens further tabs over the DevTools endpoint.

## gjsify gaps met here

Fix them in gjsify, never around them (werkstatt AGENTS.md § Core deps). Found while building
0.1, 2026-09-25:

| Gap | Consumer-side state |
|---|---|
| `gjsify install` does not install required `peerDependencies` (npm ≥ 7 does), and does not prune packages the lockfile no longer lists | no longer hits beifahrer since the WXT build is gone (ADR 0002); a clean `rm -rf node_modules && gjsify install` before trusting a green build |
| `@gjsify/ws` client: `new WebSocket(url, options)` treated as protocols; URL without path fails the handshake | tests use the three-argument form and `…/`. The extension is unaffected (browsers normalise) |
| `@gjsify/ws` server: `connection` passes the raw `Soup.ServerMessage`, no `req.headers` | `verifyClient` refuses page origins on both runtimes; the role check after the hello reads the Origin through `handshakeOriginKind()` (bridge.ts), which knows both shapes and fails closed on any other |
| `@gjsify/ws` server: a taken port carries no `code: 'EADDRINUSE'`, only a localised Gio message | `isAddressInUse()` matches the message; the hub-or-peer election tries the relay after *any* bind error, so a missed match cannot cost a session the browser |
| `gjsify format` under GJS silently skips HTML (oxfmt-native cannot format it) — [gjsify#1807](https://github.com/gjsify/gjsify/issues/1807) | `oxfmt` is called directly, locally and in CI |
| `app/src/frontends/mcp/runtime.ts` is the **third** verbatim copy (postbote, troedler) | extract to a shared `@gjsify/mcp`; until then change all three or none |

## Conventions

- Conventional commits (`feat(extension): …`, `fix(bridge): …`), imperative, subject ≤ 50 chars.
- This repo is a submodule of werkstatt: commit here first, then bump the pointer in the parent.
- All `@gjsify/*` pins are the same exact version.
- Docs in English. Comments explain *why*.
