# AGENTS.md — beifahrer

Operating guide for AI agents in the **beifahrer** repo. It follows the
[agents.md](https://agents.md/) convention; the human overview is in [README.md](README.md). This
repo is a submodule of **werkstatt**, whose [AGENTS.md](../../AGENTS.md) holds the workspace rules.
This file is the beifahrer-specific layer and wins where the two differ.

## What this is

A WebExtension (Firefox MV2, Chromium MV3, built with [WXT](https://wxt.dev)) plus a loopback
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
`REQUIRED_LEVEL` (policy.ts) with its level. Adding a method means adding its level there first.
|**Host access follows the policy.** Host permissions are *optional* and requested per origin when
the person raises that origin's level. A write needs level `write`, the browser's grant for the
origin, and the person's confirmation, unless they switched confirmation off for that origin.
|**Redact below `read`.** A tab on a `none` origin shows its host only: never title, path or query.
|**Never fill a password field; never switch the person's tab** (screenshots refuse a tab that is not
the active one).
|**Nothing leaves the device.** No telemetry, no remote endpoint. The Firefox manifest declares
`data_collection_permissions: none`, and that must stay true.
|**Fixtures are synthetic.** Never commit a captured page or a screenshot of a real site. What the
extension reads is the person's private data.

## Layout

| Path | Contains | Runs on |
|---|---|---|
| `packages/core` | **Pure, zero deps.** Wire protocol, policy, redaction | GJS, Node, browser |
| `app/` | `beifahrer` CLI: `mcp`, `token`, `serve`, `call`. The bridge (`src/bridge/`), MCP tools | GJS (bundled by gjsify); tests also on Node |
| `extension/` | WXT project: background, page agent, popup, options, confirm window | browser |
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
node tests/e2e/browsers.e2e.mjs all             # needs Playwright's Chromium in ~/.cache/ms-playwright + firefox
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
- **Headless Chromium takes one start URL.** A second one makes it exit with "Multiple targets are
  not supported in headless mode". The e2e opens further tabs over the DevTools endpoint.

## gjsify gaps met here

Fix them in gjsify, never around them (werkstatt AGENTS.md § Core deps). Found while building
0.1, 2026-09-25:

| Gap | Consumer-side state |
|---|---|
| `gjsify install` does not install required `peerDependencies` (npm ≥ 7 does) | `vite` is an explicit devDependency of `extension/`. **Delete it once gjsify resolves peers** |
| `@gjsify/ws` client: `new WebSocket(url, options)` treated as protocols; URL without path fails the handshake | tests use the three-argument form and `…/`. The extension is unaffected (browsers normalise) |
| `@gjsify/ws` server: `connection` passes the raw `Soup.ServerMessage`, no `req.headers` | the bridge checks the origin in `verifyClient`, which works on both runtimes and is the better place anyway |
| `gjsify format` under GJS silently skips HTML (oxfmt-native cannot format it) — [gjsify#1807](https://github.com/gjsify/gjsify/issues/1807) | `oxfmt` is called directly, locally and in CI |
| `app/src/frontends/mcp/runtime.ts` is the **third** verbatim copy (postbote, troedler) | extract to a shared `@gjsify/mcp`; until then change all three or none |

## Conventions

- Conventional commits (`feat(extension): …`, `fix(bridge): …`), imperative, subject ≤ 50 chars.
- This repo is a submodule of werkstatt: commit here first, then bump the pointer in the parent.
- All `@gjsify/*` pins are the same exact version.
- Docs in English. Comments explain *why*.
