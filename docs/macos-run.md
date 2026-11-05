# Running Beifahrer on a MacBook (Apple silicon, macOS 27)

The handover for a person running this repository on their own MacBook. It exists because the
prerequisites are **not** repository commands and are written down nowhere in this repo: a person
who improvises them fails on a Homebrew package name, a Node major, or a Chromium binary that does
not exist — and each of those failures looks like a Beifahrer bug.

Work top to bottom. Every step carries the command that does it, or says why there is none. Where
something is not settled, it is marked `<verify: …>` — check it, do not assume it.

Everything below is for **Apple silicon**. The gjsify native bindings are per-OS prebuilds; there
is no x86_64 Mac leg here.

---

## 1. Prerequisites

### 1.1 Xcode Command Line Tools

The extension's icons are rasterized from SVG by GJS + librsvg at build time; that is a compile
toolchain. If `clang` is missing, `gjsify install` or a build step dies in a way that reads like a
bundler error.

```sh
xcode-select --install
xcode-select -p        # must print a path, not "xcode-select: error"
```

### 1.2 Node 24 — exactly 24, not "latest"

`app/package.json:13` declares `"node": ">=24"`, and CI sets up Node 24
(`.github/workflows/ci.yml:36-38`) because gjsify's native install backend prebuilds for node 24:
another major loads a mismatched ABI and `gjsify install` segfaults.

```sh
node --version          # must print v24.x
```

If Homebrew's `node` is not 24, install it as `node@24` and put it first on `PATH`:

```sh
brew install node@24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"    # Intel prefix: /usr/local/opt/node@24/bin
node --version
```

Make that `export` permanent in your shell profile: every later step in this file, including every
`gjsify` child process, needs it.

### 1.3 The system packages

gjsify's own ADR names them (`gjsify/gjsify/docs/adr/0077-…:232`), and that is where the list
comes from — not from CI:

```sh
brew install gjs librsvg gobject-introspection
```

| Package | Why Beifahrer needs it |
|---|---|
| `gjs` | The app runs on GJS, and the extension is **bundled on GJS** too ([ADR 0002](adr/0002-build-on-gjs-not-wxt.md)). The e2e spawns `gjsify run app/dist/gjs/beifahrer.mjs`. |
| `librsvg` | `extension/scripts/icons.ts` renders the toolbar icons from the app icon in `data/icons/` — same rasterizer `ship` uses. |
| `gobject-introspection` | The GJS typelibs `Gi` imports at runtime. |

The Homebrew `gjs` formula is 1.88.x, which pairs with spidermonkey 140.x. That pairing is what
makes gjsify's intrinsic mozjs-major pin hold (gjsify ADR 0011) — the shim links GJS's
SpiderMonkey and is rebuilt against it, so a gjs outside that range is not "a warning", it is a
mismatched native binding. A known-good darwin toolchain, for comparison
(`../../docs/workstation/macos-test-vm.md:112-127`): gjs 1.88.1, spidermonkey (mozjs-140) 140.13.0,
gobject-introspection 1.86.0, Node 24, Xcode CLT.

```sh
gjs --version
brew list --versions gjs librsvg gobject-introspection
```

<verify: what to check> that your `gjs` is 1.88.x. If Homebrew has moved on, record the version you
measured with at the top of your own notes — nothing in this repository pins it on macOS.

### 1.4 No libsoup install is needed

CI's `dnf install … libsoup3 …` line (`.github/workflows/ci.yml:26-30`) is **Linux-only. Do not
copy it to a Mac.** The bridge serves WebSockets through `@gjsify/ws`, and gjsify resolves that per
OS: Soup on Linux, the darwin `http-soup-bridge` prebuild on macOS. Nothing on this path is a
Homebrew formula you have to install.

<verify: what to check> the first `gjsify install` — if it fails naming `Soup` or a `Soup-3.0`
typelib, that is a different problem from this one (a typelib that Homebrew installed outside
girepository's default search path) and belongs in gjsify, not in this file.

### 1.5 Bootstrap the gjsify CLI at the version the repo pins

Read the version out of the repo rather than repeating it, so the two cannot drift — this is
exactly what CI does (`.github/workflows/ci.yml:49-55`):

```sh
cd /path/to/beifahrer
npm install -g "@gjsify/cli@$(node -p "require('./app/package.json').devDependencies['@gjsify/cli']")"
gjsify --version        # currently 0.53.0
```

A globally installed `gjsify` from some other project is a different version and will fail in ways
that have nothing to do with your machine. If `gjsify --version` does not print `0.53.0`, stop and
redo this step.

### 1.6 Dependencies

```sh
gjsify install            # NEVER `npm install`
```

`npm install` writes a `node_modules` that gjsify does not use and cannot see. `gjsify install`
resolves the workspace through `gjsify-lock.json`. CI adds `--immutable`; add it here too if you
want the lock to fail rather than move.

---

## 2. Runbook A — the end-to-end suite

The chain: MCP client (the driver) → `beifahrer mcp` on GJS → loopback bridge → extension →
fixture page. Both browsers, several sessions each.

### 2.1 Get a Chromium that loads unpacked extensions

**Branded Chrome ≥ 137 ignores `--load-extension`.** No extension loads, so no scenario finds a
session, so the whole run fails with no hint about the browser. You need Chrome for Testing, which
means Playwright's build.

Playwright is deliberately **not** a dependency of this repository
(`extension/scripts/platform.ts:56-58`): there is no installed `executablePath()` to ask, so the
driver walks Playwright's cache directory itself. That means the cache has to exist. Populate it:

```sh
npx playwright install chromium
```

`npx` fetches Playwright ad hoc and runs it; it adds nothing to this repository and creates no
dependency entry. Playwright's macOS cache root is `~/Library/Caches/ms-playwright`
(`platform.ts:46-49`).

Then confirm the driver will find it:

```sh
ls -d ~/Library/Caches/ms-playwright/chromium-*
```

Inside that revision the driver looks for, in order
(`extension/scripts/platform.ts:33-36`):

- `chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium`
- `chrome-mac/Chromium.app/Contents/MacOS/Chromium`

Both are marked **NOT VERIFIED** in the source — they are Playwright's documented layout, and no
macOS host was available when they were written. If neither exists, do not edit the table; tell the
driver where the binary is:

```sh
export BEIFAHRER_E2E_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"
```

`BEIFAHRER_E2E_CHROMIUM` is the driver's own last resort — it names the variable itself in the error
when it gives up (`tests/e2e/browsers.e2e.mjs:423`):

```
no Chromium that loads unpacked extensions — set BEIFAHRER_E2E_CHROMIUM
```

<verify: what to check> that your run used Chrome for Testing and not branded Chrome: with
`BEIFAHRER_E2E_CHROMIUM` unset, the driver refuses to start rather than silently using `/Applications/Google Chrome.app`. If it starts, the binary it found is a Chrome for Testing build.

### 2.2 Firefox

The driver prefers a real Firefox install over Playwright's headless-shell build, and looks at the
standard macOS location (`extension/scripts/platform.ts:84-101`):

```sh
ls /Applications/Firefox.app/Contents/MacOS/firefox
```

That location is also marked not verified in the source; a miss falls through to a bare `firefox`
on `PATH`. Either install Firefox, or point at it:

```sh
export BEIFAHRER_E2E_FIREFOX=/Applications/Firefox.app/Contents/MacOS/firefox
```

To run one browser only, pass `chromium` or `firefox` as the argument.

### 2.3 Build the app bundle, then run

The **extension needs no separate build step**: the driver builds it itself, seeded for the e2e
(`buildExtension()`, `tests/e2e/browsers.e2e.mjs:349-359`), into `extension/.output-e2e/`. The
**app bundle** is the one you build:

```sh
gjsify workspace beifahrer-app build     # app/dist/gjs/beifahrer.mjs — the bridge the driver spawns
node tests/e2e/browsers.e2e.mjs all
```

On a sandboxed or CI-like host, run the e2e in the background: a long-running foreground GJS process
gets killed there (Exit 144).

Ports, if you need them: fixture `47901`, DevTools `47903`, bridges `47910–47919`, all shifted by
`$BEIFAHRER_E2E_PORT_BASE` (default `47900`) so two runs can share a machine. Never the person's own
`47813–47822`.

---

## 3. Runbook B — the Safari extension

Split this into two halves and do not confuse them: **packaging and the unsigned local build are
automated; loading it into Safari is a person's clicks, because Safari's own UI has no scripted
route.**

### 3.1 Build the extension — automated

```sh
gjsify workspace beifahrer-extension build
ls extension/.output/safari-mv3/
```

That target really is produced (`extension/scripts/build.ts:160-181`), and it is deliberately
different from the Chromium and Firefox ones: a **non-persistent background page**, not a service
worker (`extension/manifest.ts:125-134`). Reason, measured on Safari 27.0 / macOS 27 on 2026-09-25:
in Safari's extension service worker, `new WebSocket('ws://127.0.0.1:…')` hangs the worker for
good — no error, no CPU, no later event, and a Web Inspector console attached to it evaluates
nothing. The same bundle in a background page connects at once. So: on Safari, a blank or inert
extension is this, not a broken build.

### 3.2 Package it into a macOS app and build it — automated

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # Xcode itself, not the CLT
cd extension && sh scripts/safari-build.sh
```

`extension/scripts/safari-build.sh` wraps two Xcode steps into one, into the gitignored
`extension/.output-safari-xcode/`:

1. `xcrun safari-web-extension-packager` — Apple's current name for what used to be
   `safari-web-extension-converter` (renamed; `--help` still calls the binary
   `safari-web-extension-packager`, measured on Xcode 27.1) — wraps `.output/safari-mv3` into an
   Xcode project with a container app + an app extension target (Swift, macOS-only).
2. `xcodebuild … build` with `CODE_SIGN_IDENTITY=-` (ad-hoc, "Sign to Run Locally") so the app
   builds and runs with **no Apple Developer certificate** — exactly the unsigned developer path
   this task needs today.

**A measured Apple-tool bug, not a project bug:** given `--app-name "Beifahrer"
--bundle-identifier eu.jumplink.beifahrer`, Xcode 27.1 keeps the extension's id as given
(`eu.jumplink.beifahrer.Extension`) but capitalizes the container APP's id instead
(`eu.jumplink.Beifahrer`) — which fails `ValidateEmbeddedBinary` ("Embedded binary's bundle
identifier is not prefixed with the parent app's bundle identifier"). The script patches
`project.pbxproj` back to the lowercase id it was given before building. <verify: whether a later
Xcode still does this> by diffing `PRODUCT_BUNDLE_IDENTIFIER` in a fresh `--force` run.

Verified end to end on this machine (Xcode 27.1, macOS 27, 2026-11-05):
`codesign -dv extension/.output-safari-xcode/Beifahrer/build/Build/Products/Debug/Beifahrer.app`
reports `Identifier=eu.jumplink.beifahrer`, `Signature=adhoc`, `BUILD SUCCEEDED`.

### 3.3 Load it in Safari — a person's clicks, not a script

Safari never reads a `.app` by API; every step below is a human in Safari's own UI. None of it can
be scripted or done by an agent (it changes the person's own browser settings).

1. Open the built app once: `open extension/.output-safari-xcode/Beifahrer/build/Build/Products/Debug/Beifahrer.app`
   — this registers its extension with the system (`RegisterWithLaunchServices`, already run by the
   build), it does not need to stay open.
2. Safari → Settings → Developer tab → check **"Allow Unsigned Extensions"** (Safari's Develop menu
   must be enabled first: Safari → Settings → Advanced → "Show features for web developers", if that
   checkbox is not already visible).
3. Safari → Settings → Extensions → check **"Beifahrer"** to enable it.
4. Safari → Settings → Extensions → "Beifahrer" → turn on **"Allow on all websites"**, or grant it
   per site from the toolbar's extension icon the first time it asks for a page.
5. Click the Beifahrer toolbar icon → paste the pairing token from §3.4 into the options page.

<verify: unsigned extensions expire> whether "Allow Unsigned Extensions" needs re-checking after a
Safari restart or after 24 hours — `docs/traps-browser-platform.md` notes a *temporary* extension
(the pre-3.2 state, loaded without an app at all) is dropped that way; whether an ad-hoc-signed app
extension is the same is unmeasured here.

### 3.4 Developer ID distribution outside the Mac App Store — researched, not built

This task's longer-term goal (Developer-ID-signed + notarized download, no Apple review, no store).
What changed and what it needs, from Apple's own pages (fetched 2026-11-05):

- **Safari 18.4 (macOS Sequoia 15.4, March 2025) added exactly this path.** Before it, a Safari Web
  Extension could only reach an end user through the Mac App Store; "Allow Unsigned Extensions" was
  developer/tester-only. Source: [WebKit: *Developer ID-Signed and Notarized Safari Web
  Extensions*](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/#developer-id-signed-and-notarized-safari-web-extensions) —
  "Safari 18.4 on macOS now supports Safari Web Extensions that have been Developer ID-signed and
  notarized… Once notarized, your app and extension is ready for distribution and use in Safari."
  Since this machine runs Xcode 27.1 / a much later macOS, the minimum OS is already met.
- **Apple's own how-to:** [*Distributing your Safari web extension* — "Distribute your Developer
  ID–signed and notarized extension outside the Mac App Store"](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension#Distribute-your-Developer-ID-signed-and-notarized-extension-outside-the-Mac-App-Store):
  sign the container app (which carries the extension) with a **Developer ID Application**
  certificate, then notarize it — the same pipeline as any non-App-Store Mac app, not an
  extension-specific one. It points at [*Developer ID*](https://developer.apple.com/support/developer-id/)
  and [*Notarizing macOS software before distribution*](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
- **What that pipeline needs, from the notarization page and general Developer ID requirements**
  (standard for every Developer-ID Mac app since macOS 10.14.5, nothing extension-specific found):
  a **Developer ID Application** certificate issued to the enrolled Apple Developer account (Pascal
  has the account; **no certificate exists yet** — this is the blocking step); **Hardened Runtime**
  enabled on the app target (`ENABLE_HARDENED_RUNTIME = YES`, plus whatever entitlements the app
  actually uses — this app needs none beyond the extension's own, since it has no app-group IPC: the
  container app and the extension talk to the bridge over `ws://127.0.0.1`, not shared storage);
  `codesign --options runtime` instead of ad-hoc; then `xcrun notarytool submit … --wait` against an
  **App Store Connect API key** or an Apple ID + app-specific password, and `xcrun stapler staple`
  the ticket onto the `.app` so Gatekeeper can verify it offline.
- **Download format:** nothing in Apple's extension docs names one specifically — it is a regular
  notarized Mac app at that point, so the same `.dmg`/`.zip` choice applies as the CLI's own macOS
  packages (`.github/workflows/release.yml:132-135` already builds both for the CLI).
- **Not done here, and why:** no certificate exists yet (task scope says so), and generating one is
  an Apple Developer Portal action with Pascal's account — outside what this task or an agent should
  do. Once it exists, `ci.yml`'s existing macOS sign+notarize+staple job for the CLI
  (`macos` job, referenced at `release.yml:194-196`) is the pattern to extend to this Xcode project,
  not a new pipeline.

### 3.5 Pair it, so the extension finds the bridge

```sh
gjsify run app/dist/gjs/beifahrer.mjs token     # paste it into the extension's options page
```

The token is what makes the background connect, and on Safari that is also what arms the worker
hang above — a Safari extension that never connects after a token is set is the trap, not a
mystery.

---

## 4. Accent measurement (issue #18)

The same Mac answers the **macOS half** of issue #18: before writing any macOS accent code, find
out whether the browser already hands the page the system's accent colour. `probes/accent/` is the
instrument; the readings are empty, and they need a person at this machine. This is a measurement,
not a feature — it touches no product code.

### 4.1 The OS side

```sh
node probes/accent/accent-report.mjs
node probes/accent/accent-report.mjs --json      # the same content, machine-readable
```

Zero dependencies, plain Node. It reads `defaults read -g AppleAccentColor` and `AppleInterfaceStyle`
and prints every source, including the ones this host cannot answer, so a missing column reads as
"not filled in here" rather than "not checked".

Two asymmetries in its output are load-bearing and already in the code:

- **On macOS an absent key is a value, not a gap.** Someone who never touched the accent has no
  `AppleAccentColor`, and someone in light mode has no `AppleInterfaceStyle`. Absent means **blue**
  and **light**. Reading absent as "unknown" would report a correct system as unreadable.
- **Ignore any GNOME row.** Homebrew installs `gsettings-desktop-schemas` on macOS, so `gsettings`
  answers with the schema default `'blue'` — a measurement that looks fine and is fiction. The
  script gates the read on the session, same as `isGnomeSession()` in the bridge.

### 4.2 The browser side, by hand

Set the desktop accent to something unmistakable first — **purple**:

> System Settings → Appearance → Accent colour → Purple

This is the step people skip, and skipping it makes the whole measurement worthless: on macOS the
system blue *is* the default accent, so a single run with the default proves nothing. A browser that
only ever reports a blue fallback has to be tellable from one that follows the system.

Then open the probe as a plain `file://` page — it needs no server and no origin, and it says so in
its own output:

- Safari, Chrome and Firefox, all three.
- Compact JSON is in the **tab title**; the readable one is in the `<pre>`.

What each run reports: `accentColor` (whether `CSS.supports('accent-color', 'red')`, what
`getComputedStyle` says — note it returns the keyword **`auto`**, not a colour — plus the colour the
engine actually painted, cross-checked against native controls); `prefersColorScheme`;
`systemColors` (`AccentColor`, `AccentColorText`, `AccentColorDark`, each as
`supported`/`unsupported`/`unknown` and never as a colour that may be a fallback); and `page`.

### 4.3 Merge the two

A browser run is exactly one object of the `probe.html` shape. Put it in the **`browserRuns` array**
of the `--json` output, one entry per browser and platform, adding `os` and `osName` — the system
value it is to be compared against. The script prints these instructions itself, so you do not have
to come back to this file to find them.

Report the verdict per browser as one of three: `AccentColor` **follows the system accent** (no
bridge path needed there; the fix belongs in `@gjsify/adwaita-web`, gjsify#1821) · `AccentColor`
**exists but is a fixed fallback** (a bridge path is needed, and the bridge is the only place that
can supply it) · `AccentColor` **unsupported** (same, and the gap is wider than a colour).

Until the rows are filled in, do not claim that a browser does or does not report the desktop
accent. `probes/accent/README.md` is the full write-up; this section is only the macOS procedure.

---

## 5. What will fail, and why

Each of these reads as an unrelated failure. Each has a known cause.

| Symptom | Cause | Do |
|---|---|---|
| `McpError: -32000 Connection closed` on **every** scenario | `app/dist` was thrown away without a following build. `rm -rf app/dist` also deletes the bridge bundle `gjs/beifahrer.mjs` that the e2e spawns, and `gjsify workspace beifahrer-app **test**` does not put it back — only `build` does (`docs/traps-build-and-test.md`). It reads like a broken bridge and is not one. | `gjsify workspace beifahrer-app build` |
| `dnf: command not found`, or a hunt for `libsoup3` | CI's system-package line is Linux. Nothing is missing on macOS; `@gjsify/ws` resolves per OS to the darwin `http-soup-bridge` prebuild. | Ignore the line. See §1.4. |
| `gjsify install` segfaults, or an ABI/native-binding error | Wrong Node major. gjsify's install backend prebuilds for node 24 (CI sets it up for exactly this reason). | `node --version` must be `v24.x` (§1.2) |
| No scenario finds a session; extension never loads | Branded Chrome ≥ 137 ignores `--load-extension`. You need Chrome for Testing. | §2.1: `npx playwright install chromium`, or set `BEIFAHRER_E2E_CHROMIUM` |
| `no Chromium that loads unpacked extensions — set BEIFAHRER_E2E_CHROMIUM` | The driver found no `chromium-<rev>` directory with either documented darwin binary inside it. Both paths are marked NOT VERIFIED in `platform.ts`. | Set the variable to the real binary. Do not edit the table. |
| Firefox binary not found | The standard macOS location is a candidate, not a guarantee; the fallback is a bare `firefox` on `PATH`. | Set `BEIFAHRER_E2E_FIREFOX` |
| On Safari: blank page, extension inert, Web Inspector console evaluates nothing | Safari's extension **service worker** hangs on `new WebSocket('ws://127.0.0.1:…')`. It only bites once a token is set, because only then does the worker connect. | Already designed around: `safari-mv3` uses a non-persistent background page. If you see it anyway, you are running a Chromium/Firefox build, not the safari one. |
| On Safari: "no extension found" in Safari's settings | Safari takes an **app bundle**, not a folder, and that app has to be opened once before Safari registers it. | §3.2 then §3.3 step 1 |
| `xcodebuild`: `ValidateEmbeddedBinary … not prefixed with the parent app's bundle identifier` | The packager itself mis-capitalizes the container app's id (§3.2) — not a project misconfiguration. | `extension/scripts/safari-build.sh` already patches this; if it recurs after an Xcode upgrade, diff `PRODUCT_BUNDLE_IDENTIFIER` in the generated `project.pbxproj` |
| `xcodebuild: error: tool requires Xcode, but active developer directory is a command line tools instance` | `xcode-select`'s default points at the CLT, which has no `xcodebuild`. | `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` |
| Unit tests report a message you edited three lines away | `gjsify test` reuses `app/dist-test/test.gjs.mjs` when only `packages/core` changed: the bundler's cache is keyed on the entry files, not on what they import. | `rm -rf app/dist-test` before believing a green run — then **rebuild**, see the first row |
| A Safari or MV3 `page_evaluate` answers `unsupported` | Not a macOS problem. An MV3 content script cannot `eval` (`script-src` may only name `self`, `none`, `wasm-unsafe-eval`, localhost), so the script run is engine-dependent ([ADR 0012](adr/0012-running-the-agents-own-script-in-the-page.md)). | Expected. The Firefox build supports it. |
| A long-running GJS process exits 144 on a sandboxed host | The sandbox kills long-running **foreground** GJS processes. | Run in the background |