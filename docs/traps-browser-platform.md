# Browser and platform traps already paid for

Every entry is a measured behaviour of the platform that cost time, not a preference. They were
moved out of [AGENTS.md](../AGENTS.md) — where they were loaded on every turn — and nothing here is
a task list: each one is a fact the code already accounts for, kept with the reason so it is not
"simplified" back into the bug.

Companion files: [traps-extension-code.md](traps-extension-code.md) ·
[traps-build-and-test.md](traps-build-and-test.md) · [gjsify-gaps.md](gjsify-gaps.md).

## Engine differences that shape the code

## Why there is no `page_console`

A page's console is not readable by a WebExtension: a content script shares the page's DOM but not its
JavaScript world, so the page's `console.log` goes to the page's console and the content script's to
the extension's, and no API bridges the two. The only route into the page's world is defeating the
page's CSP with a `<script>` element — the same thing
[ADR 0012](adr/0012-running-the-agents-own-script-in-the-page.md) refuses for `world: "main"`. A tool
that answered "no entries" would be a lie, and a lie there is worse than a gap, because an agent
debugs with it: it would conclude the page logged nothing when it cannot know. So the question behind
"the button did nothing" is answered by `page.network` instead (see the optional `webRequest`
feature), and the absence of a console tool is a decision to keep, not a backlog item.

## Engine differences that shape the code

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
- **A Manifest V3 content script cannot `eval` or `new Function`.** It shares the extension's
  content security policy, `script-src` there may only name `self`, `none`, `wasm-unsafe-eval` and
  (unpacked) localhost, and Chrome refuses to INSTALL an extension whose `extension_pages` policy
  contains `'unsafe-eval'` — so there is no manifest that unlocks it. A Manifest V2 content script
  has no CSP of its own and may. This is why `page_evaluate` works in the Firefox build and answers
  `unsupported` in the Chromium and Safari ones (ADR 0012), and why the e2e's script run is
  engine-dependent. The workarounds (`userScripts` with *Allow user scripts*, `chrome.debugger`) are
  developer-mode powers, not capabilities to quietly reach for.
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
- **Chromium's `permissions.remove` subtracts by URL-pattern coverage, not by identity.** Removing
  `http://*/*` + `https://*/*` (ADR 0010's "all sites" grant) also strips any narrower host
  permission those patterns cover — a site's own, requested long before any wildcard grant existed
  — whether or not the wildcard was ever actually granted. `hostsToRelease` (policy.ts) holds the
  wildcard back while any site is still `needed`, rather than release it and rely on the missing-
  grant prompt to win it back; measured with a throwaway probe extension, since `permissions.request`
  never resolves headless with nobody to click the browser's own bubble (had to seed the profile's
  stored extension permissions directly). Firefox removes exactly the listed patterns.
- **Lazy tabs differ per engine** (from the API docs; the e2e covers the restore, not each
  branch). Firefox creates `discarded: true` tabs with a `title`, but not pinned ones. Chromium
  rejects the key, so its tabs are created and then discarded once the URL has committed
  (`openLazy` in sessions-store.ts). A loading Chromium tab reports its target in `pendingUrl`
  with `url` empty, so tab listings read both.
- **A whole window is closed with `windows.remove`**, not tab by tab, so that the browser's
  recently-closed list holds it as one window (the e2e restores it from there).

## Synthetic input reaches the page but not the browser

- **A synthetic key event performs no browser default action.** An event created in a content
  script and dispatched on the page is untrusted, and a browser does nothing for it: a real Enter
  submits the form, a dispatched one does not, and `preventDefault()` on the keydown means "the page
  handles this key", not "beifahrer must not". So `press` in page-agent.ts dispatches the three
  events and then does the default action itself for the keys whose behaviour the platform fixes
  (the character appears, Backspace deletes, Tab moves the focus, Enter submits, Space ticks) —
  and only when the keydown was not cancelled, which is what the page claiming a key looks like.
  Two consequences worth keeping: browser keys (F12, Ctrl+T) are refused BY NAME rather than
  dropped, because a dropped key looks like a page that ignored it; and a page that checks
  `event.isTrusted` sees `false`, which no amount of care in the page agent can change — only
  `page.evaluate` in Firefox's own world is closer, and that is not the same thing.
- **Firefox will not let an extension's synthetic paste carry data.** The page's listener receives
  the event, but `getData()` returns '' for data an extension set. This is deliberate principal
  isolation, not a bug to fix. Rich-text filling therefore uses paste in Chromium and
  `execCommand` in Firefox, and checks after every step that the text actually landed
  (`fillRich` in page-agent.ts).

## Headless and remote drivers

- **Headless Chromium takes one start URL.** A second one makes it exit with "Multiple targets are
  not supported in headless mode". The e2e opens further tabs over the DevTools endpoint.
- **No remote client may navigate a tab to an extension page.** Chromium answers `/json/new` with
  ERR_FILE_NOT_FOUND, Firefox's BiDi with "not allowed in this context", and Firefox drops
  `--start-url moz-extension://…`. `tests/e2e/ui-pages.mjs` opens them from the extension's
  service worker (Chromium) and the browser window in BiDi's chrome scope (Firefox).
- **Chromium has component extensions with a `background.js` worker too.** Pick beifahrer's by
  its manifest (`default_locale`), not by the worker's file name.