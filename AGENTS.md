# AGENTS.md — Beifahrer

Operating guide for AI agents in the **Beifahrer** repo, following the
[agents.md](https://agents.md/) convention; the human overview is in [README.md](README.md). A
submodule of **werkstatt**, whose [AGENTS.md](../../AGENTS.md) holds the workspace rules — this file
is the Beifahrer layer and wins where the two differ. What is read once lives in
[docs/](docs/README.md); every rule below links the file holding its detail.

## What this is

A WebExtension (Firefox MV2, Chromium MV3, bundled by gjsify on GJS) plus a loopback bridge exposed
as an MCP server. The bridge is a TypeScript app that **runs on GJS via gjsify**, like postbote and
troedler. Together they let an agent use the person's *own* browser under a per-site policy the
person sets in that browser. Why, and what else was considered:
[ADR 0001](docs/adr/0001-a-browser-extension-not-a-driven-browser.md).

**Linux ships GJS; any host with Node 24 can run the bridge** — GJS is the default because the Linux
releases are built and tested there, but the e2e runs the whole chain with the bridge started by plain
`node`. Each runtime needs its own bundle, because gjsify rewrites GJS-only imports per `--app` WHILE
BUILDING: a build difference, not a source one
([two bundles](docs/traps-build-and-test.md)).

## Leitplanken (hard rules)

These are not style. Removing one silently changes what this project *is*.

|**The policy is enforced in the extension, never in the bridge.** The bridge is the process the
agent talks to; a gate there is a gate the agent's side controls. `packages/core/src/policy.ts`
decides, and `extension/src/handlers.ts` calls it before *every* page access.
|**Fail closed.** An unknown origin is `none`. A non-http(s) URL has no origin. An unknown method is
refused. A malformed stored policy entry is dropped, not widened. The MCP read-only gate drops a
tool that forgot its annotation.
|**No `evaluate` — except the one that is switched off, confirmed and shown.** No method runs
agent-supplied JavaScript *by default*. Every capability is a named method in `REQUIRED_LEVEL`
(policy.ts) with its level, and in `FEATURE_OF` (features.ts) with exactly ONE feature. Adding a
method means adding both there first. `page.evaluate` is the one exception and it is the load-bearing
one ([ADR 0012](docs/adr/0012-running-the-agents-own-script-in-the-page.md)): own feature switch
`script`, **off by default**; `write` level, never `read`; `ALWAYS_CONFIRM` (policy.ts), so no
`confirmWrites: false` can silence it; the confirm window shows the whole script and offers no
"Always allow"; the result is projected into bounded JSON with a `truncated` flag; the extension's
own `chrome`/`browser` globals are shadowed out of the script's scope, because a script that could
read `storage` could clear the pause and widen every level; and the tab's origin is re-read after the
window, since the person answered for a page and the page can move. It runs in the page agent's
isolated world, and `world: "main"` is refused with a reason — no extension API runs its own code as
a string in a page's world. Removing any of those conditions removes the reason it may exist;
changing them is an ADR, not a patch. One more condition is not ours: **a Manifest V3 content script
cannot compile a string into code at all** (it shares the extension's CSP, which cannot name
`unsafe-eval`), so the page agent probes `new Function('')` once and answers `unsupported` on Chromium
and Safari; Firefox's Manifest V2 build runs the script. Probe it, never infer it from a manifest
field ([trap](docs/traps-browser-platform.md)).
|**There is no `page_console`, and there is no way to make one.** A content script shares the page's
DOM but not its JavaScript world and no API bridges the two; the only route into the page's world is
defeating the page's CSP, which ADR 0012 refuses. A tool answering "no entries" would be a lie, and
a lie there is worse than a gap — an agent debugs with it and concludes the page logged nothing when
it cannot know. "The button did nothing" is answered by `page.network` (optional `webRequest`
feature); the gap is a decision to keep, not a backlog item ([why](docs/traps-browser-platform.md)).
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
every screenshot. Do not make any of them optional. One ladder, loudest first, in `alarmOf` (core):
**not connected is red** and outranks the pause (yellow) and the live grant (blue), because without
a bridge the extension does nothing ([ADR 0014](docs/adr/0014-not-connected-speaks-first.md)).
Colour never says it alone: the state word, the tooltip and the one shared banner
(`src/ui/banner.ts`) carry the same state beside it.
|**A frame is gated on its OWN origin, never on the page's** (issue #32). The page agent is injected
into every frame (`allFrames`, and only when a call asks — there is no `content_scripts` entry, so it
costs nothing on a page nobody is reading), each frame is addressed on its own, and the policy is
asked about the FRAME's URL: a frame from an origin below `read` is never asked, so it is invisible in
the outline, in `read` and in `find` while the page around it stays readable. Granting a site does not
grant what that site embeds — the clickjacking case that `all_frames` in a manifest would have opened
silently. Refs carry their frame (`b2e12`), because each frame has its OWN registry and an ambiguous
ref in a write is a write on the wrong element; the confirm window names the FRAME's origin, and the
pill says "this embedded page" so the words do not name the top site. Frames are learned by
announcing themselves (`FRAME_HELLO`, the only thing a content script may send unprompted besides
Stop) — `sender.frameId` comes from the browser, so the table needs no permission. The order matters:
inject into all frames FIRST, since a frame only announces itself once its agent is INJECTED, and wait
for a frame with a real web URL (re-asked, not remembered), never a sleep
([traps](docs/traps-extension-code.md)).
|**Host access follows the policy.** Host permissions are *optional* and requested per origin when
the person raises that origin's level. A write needs level `write`, the browser's grant for the
origin, and the person's confirmation, unless they switched confirmation off for that origin.
|**Temporary access is temporary** ([ADR 0010](docs/adr/0010-temporary-access-and-asking-on-demand.md)).
"All sites" and a prompt's "For this session" are `Grant`s (policy.ts) in `storage.session`, never
in the stored policy; `decide` checks their end at decision time, and `grants.ts` gives the host
access back when they end (`hostsToRelease`). An explicit rule beats the wildcard, an explicit
`none` blocks every grant and every prompt, and a write only a grant allows asks unless the person
switched asking off for that grant (`Grant.confirmWrites`, `*` only, read from the grant live for
the session asking, [ADR 0013](docs/adr/0013-all-sites-without-asking.md)) — `page.evaluate` still
always asks.
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
quotes in the copy. Pages, confirm window, pill, tooltip and any error in them: `t('key')`
(`extension/src/i18n.ts`) or `data-i18n*` in the HTML, with the key in EVERY
`extension/_locales/*/messages.json` (the build fails otherwise). MCP tool descriptions and wire error
messages are never translated. A new method needs `method_<name>` (activity words) in every locale, or
`gjsify tsc` fails.

## Layout

| Path | Contains | Runs on |
|---|---|---|
| `packages/core` | **Pure, zero deps.** Wire protocol, `ports.ts`, `connections.ts`, policy (incl. `ALWAYS_CONFIRM`), `features.ts`, toolbar look, activity entries, redaction, saved sessions, `find.ts`, `recipes.ts`, the bounds of `page.evaluate` (`evaluate.ts`), the session-registry model (`registry.ts`, ADR 0015) | GJS, Node, browser |
| `packages/local` | What every LOCAL process shares and only `node:fs`/`os`/`path` touch: `configDir()`, the pairing token, the registry's path and files. The CLI and the desktop app both read through it | GJS, Node |
| `app/` | `beifahrer` CLI: `mcp`, `token`, `status`, `serve`, `call`, `tool`; the bridge (`src/bridge/`), MCP tools, recipe runner + sources | GJS (bundled by gjsify); tests also on Node |
| `desktop/` | The native libadwaita window (ADR 0017): reads the session registry, shows the status ladder, en/de. A view, never a policy: it has no pause, resume, feature or level control | GJS and node-gi (measured on macOS arm64) |
| `extension/` | background, page agent (+ its pill), popup, options, confirm window (on `@gjsify/adwaita-web`, shared `src/ui/kit.ts` → `ui.js`), `_locales/` (en default, de), `manifest.ts` + `scripts/build.ts` | browser (build: GJS + GdkPixbuf/librsvg) |
| `recipes/` | Built-in recipes (JSON), bundled via `app/src/recipes/builtin.ts` | data |
| `tests/e2e/` | Full chain in headless Chromium + Firefox | Node driver; bridge on GJS or Node (`BEIFAHRER_E2E_BRIDGE=node`) |
| `probes/epiphany/` | The probe that measured Epiphany (ADR 0001 § 3). Re-run it before claiming support | Epiphany |

## Commands

```sh
gjsify install                                  # never npm install
gjsify workspace beifahrer-cli build            # app/dist/beifahrer.gjs.mjs
gjsify workspace beifahrer-cli test             # unit tests on gjs + node
gjsify workspace beifahrer-extension build      # both browser builds
gjsify foreach -A check && gjsify foreach -A lint
node_modules/.bin/oxfmt --check .                # not `gjsify format`: under GJS it skips HTML
node tests/e2e/browsers.e2e.mjs all             # chromium + firefox, several sessions; needs Playwright's browsers
BEIFAHRER_E2E_BRIDGE=node node tests/e2e/browsers.e2e.mjs all   # the same chain, bridge on Node (needs build:node)
```

The werkstatt sandbox kills a long-running **foreground** GJS process (Exit 144). Launch
`beifahrer serve` / `mcp`, and the e2e run that spawns one, with `run_in_background`.

**Two of these lie about being green** ([traps](docs/traps-build-and-test.md)): `gjsify check` colours
its output, so `grep "error TS"` matches NOTHING — strip the ANSI and read the command's exit status,
not the grep's; and `gjsify test` does not re-bundle when only `packages/core` changed, so
**`rm -rf app/dist-test`** before believing a green — or a red — run.

## Traps already paid for

Three files, one subject each; every entry is a measured fact with its incident, not a backlog item
([what each holds](docs/README.md)): [engine facts](docs/traps-browser-platform.md) ·
[code facts](docs/traps-extension-code.md) · [build facts](docs/traps-build-and-test.md).

Two more belong to a single code comment, not a section: **the person's sessions hold 47813–47822
while you test** (unit tests use port 0 or a random range above 50000; the e2e 47900 + offsets; the
dev browser 47830–47839 — never kill a `beifahrer mcp` you did not start) and **a recipe file must be
listed in `app/src/recipes/builtin.ts`** — the `built-in recipes` unit test fails on a file left out.

## gjsify gaps met here

Fix them in gjsify, never around them (werkstatt AGENTS.md § Core deps). The table with each gap's PR,
sha and consumer-side state: [docs/gjsify-gaps.md](docs/gjsify-gaps.md). A `@gjsify/*` bump is when
that table is re-read: a shim whose sha is in no tag is not deletable yet, however old it looks.

**The MCP runtime is upstream and the last copy of it is gone.** `app/src/frontends/mcp/runtime.ts`
was the THIRD verbatim copy of postbote's read-only gate + stdio lifecycle; at 0.54.0 that IS
`@gjsify/mcp`, and the file is deleted. Nothing was re-implemented on the way in — same bodies, same
signatures — so no client surface moved: `tools/list`, a read-only `tools/call`, the dropped-write
call and the error path are byte-identical against the two bundles. **The result helpers are NOT
part of that, and must not become part of it:** `text` / `failure` / `answer` (mcp/tools.ts) are
Beifahrer's, because a `forbidden` carries `[origin=… have=… need=…]` for the agent to relay and
`mcpError`'s `{"error": …}` cannot hold it. **The tests did NOT move with the code:** `gate.test.ts`
imports the gate from the package and keeps pinning the fail-closed direction, because a gate this
repo does not own is the one case where "it was tested here once" stops being evidence.

## Conventions

- Conventional commits (`feat(extension): …`, `fix(bridge): …`), imperative, subject ≤ 50 chars.
- **One product version** for the extension, the CLI, core and the root. Bump with
  `node tools/version.mjs set <x.y.z>` (never by hand: five files carry it), so the commit is
  `chore: bump to <x.y.z>`, not `chore(extension): …`. `version:check` runs in CI and, against the
  tag, first in the release.
- This repo is a submodule of werkstatt: commit here first, then bump the pointer in the parent.
- All `@gjsify/*` pins are the same exact version; `gjsify upgrade --check` is the gate (offline, 30
  deps) and `gjsify upgrade --align` the fix.
- Docs in English. Comments explain *why*.