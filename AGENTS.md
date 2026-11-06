# AGENTS.md — Beifahrer

Operating guide for AI agents in **Beifahrer**, a WebExtension + GJS bridge that lets an agent use the person's own browser under a per-site policy. Human overview: [README.md](README.md). This repo is a submodule of werkstatt; its [AGENTS.md](../../AGENTS.md) holds the workspace rules. Details live in [docs/](docs/README.md).

## Leitplanken (hard rules)

These are not style. Removing one silently changes what this project *is*. Full rationale and incident history: [docs/security/](docs/security/README.md).

| Rule | In code |
|---|---|
| **Policy is enforced in the extension, never the bridge.** The bridge is the process the agent talks to; a gate there is a gate the agent controls. `packages/core/src/policy.ts` decides; `extension/src/handlers.ts` calls it before every page access. | `policy.ts`, `handlers.ts` |
| **Fail closed.** Unknown origin = `none`. Non-http(s) URL has no origin. Unknown method = refused. Malformed stored policy entry = dropped. The MCP read-only gate drops a tool that forgot its annotation. | `policy.ts`, `gate.ts` |
| **No `page.evaluate` — except the one that is switched off, confirmed and shown.** Agent-supplied JavaScript runs only behind its own feature switch `script` (off by default), at `write` level, with `ALWAYS_CONFIRM`. Details: [docs/security/evaluate.md](docs/security/evaluate.md). | `policy.ts`, `features.ts`, `evaluate.ts` |
| **No `page_console`.** A content script cannot bridge into the page's JS world without defeating CSP. The gap is a decision, not a backlog item. | — |
| **Only the person resumes.** Pause (`paused` in storage) refuses every method, including `tabs.list`. Only the popup, options and shortcut clear it. | `storage`, handlers |
| **Check order:** paused → feature → per-site level → host grant → confirm. `preflight` (core) does the first two. | `preflight.ts`, `runMethod`, handlers |
| **The person sees the agent.** Toolbar icon, popup activity log (host only), in-page pill in a closed shadow root. Colour never speaks alone. | `toolbarLook`, `alarmOf`, `banner.ts` |
| **A frame is gated on its own origin.** `allFrames` only when asked; each frame has its own registry; refs carry the frame. Details: [docs/security/frames.md](docs/security/frames.md). | page agent, `FRAME_HELLO` |
| **Host access follows the policy.** Host permissions are optional and requested per origin. A write needs level `write`, the browser's origin grant, and confirmation unless the person switched it off. | `policy.ts`, `permissions` |
| **Temporary access is temporary.** "All sites" and "For this session" are session `Grant`s, never stored. An explicit rule beats `*`, explicit `none` blocks every grant and prompt. | `grants.ts`, `decide` |
| **Asking on demand fails closed.** `gate` opens the confirm window only when allowed; timeout, close or Deny is `forbidden`. | `access-prompt.ts` |
| **Redact below `read`.** A tab on `none` shows its host only, never title, path or query. | redaction |
| **Never fill a password field; never switch the person's tab.** One-time codes and QR logins are the only exceptions, each behind an off-by-default switch. | `page.enterCode`, `page.readQr` |
| **Nothing leaves the device.** No telemetry, no remote endpoint. Firefox manifest declares `data_collection_permissions: none`. | manifest |
| **One connection per agent session.** Each bridge binds its own port; the extension admits loopback, extension origin, token, then the person's dismissal. | `listenInRange`, `connections.ts` |
| **Recipes are data and hold no gate.** The bridge runs a recipe as ordinary calls; the extension checks every step. Steps address elements by role + name; `parseRecipe` refuses unknown keys. | `recipes/runner.ts`, `recipes.ts` |
| **Fixtures are synthetic.** Never commit a captured page or screenshot of a real site. | tests |
| **Every string the PERSON reads goes through i18n; what the AGENT reads stays English.** Build refuses unused keys and `!`, dashes or curly quotes. A new method needs `method_<name>` in every locale. | `extension/src/i18n.ts`, `_locales` |

## Layout

| Path | Contains | Runs on |
|---|---|---|
| `packages/core` | Pure, zero deps: wire protocol, ports, connections, policy, features, toolbar look, activity entries, redaction, saved sessions, `find.ts`, `recipes.ts`, `evaluate.ts`, `registry.ts` | GJS, Node, browser |
| `packages/local` | Local-process shared code: `configDir()`, pairing token, registry paths. | GJS, Node |
| `app/` | `beifahrer` command, bridge, MCP tools, recipe runner. | GJS; tests also Node |
| `extension/` | background, page agent, popup, options, confirm window, `_locales/`, manifest, build. | browser |
| `recipes/` | Built-in recipes (JSON), bundled via `app/src/recipes/builtin.ts`. | data |
| `tests/e2e/` | Full chain in headless Chromium + Firefox. | Node driver; bridge on GJS or Node |
| `probes/epiphany/` | Epiphany probe. | Epiphany |

## Commands

```sh
gjsify install
gjsify workspace beifahrer-app build
gjsify workspace beifahrer-app test
gjsify workspace beifahrer-extension build
gjsify foreach -A check && gjsify foreach -A lint
node_modules/.bin/oxfmt --check .
node tests/e2e/browsers.e2e.mjs all
BEIFAHRER_E2E_BRIDGE=node node tests/e2e/browsers.e2e.mjs all
```

Launch long-running GJS processes (`beifahrer serve`, `mcp`, e2e) with `run_in_background`. Two commands lie about being green: strip ANSI from `gjsify check` and read exit status; delete `app/dist-test` before trusting any `gjsify test` result. Details: [docs/traps-build-and-test.md](docs/traps-build-and-test.md).

## Traps already paid for

Measured facts with incidents, not backlog items: [engine facts](docs/traps-browser-platform.md) · [code facts](docs/traps-extension-code.md) · [build facts](docs/traps-build-and-test.md). Person's sessions use ports 47813–47822 while you test; unit tests use port 0 or random ranges above 50000; e2e uses 47900 + offsets; dev browser uses 47830–47839. A recipe file must be listed in `app/src/recipes/builtin.ts`.

## gjsify gaps

Fix gjsify gaps upstream, never around them. State table: [docs/gjsify-gaps.md](docs/gjsify-gaps.md).

## Conventions

Commit style, versioning, licences, docs language and PR screenshots: [docs/conventions.md](docs/conventions.md).
