# Privacy statement

The text below is the statement Beifahrer makes about itself. Every substantive claim carries a
`file:line` into the tree this was written against (`0.1.0`, branch off `b79a9bd`), so a reviewer can
check it rather than take it on trust. Claims that cannot be checked in code are written as such
rather than asserted.

Publish this as a web page and put its URL in every store form. Chrome, Edge and AMO all ask for
one, and Chrome's programme policy is explicit that an inaccurate privacy policy — including one
that contradicts the extension's behaviour — is grounds for removal
([programme policies](https://developer.chrome.com/docs/webstore/program-policies/policies)).

---

## 1. What Beifahrer does

Beifahrer is a browser extension. It lets an AI agent work in **your own browser, in the profile and
session you already have open** — your logged-in tabs, your extensions, your history. It does not
start a second browser.

The agent talks to the browser over a small local program — the *bridge* — that **you** run on your
own machine. The bridge is the process the agent talks to; it holds no data of its own and is not a
service.

For every action the agent wants to take, Beifahrer checks a per-site policy **that you set**, and
then asks you about the actions the policy does not already cover. The order is fixed and every
method goes through it:

1. are you paused? — the kill switch refuses everything, including listing your tabs
2. is the feature switched on? — one switch per capability
3. the per-site level you set for that origin
4. the browser's own host permission for that origin
5. for changes, a confirmation window

Only then does the agent reach the page. `extension/src/handlers.ts:1-13` states the order;
`extension/src/handlers.ts:1430` runs steps 1 and 2 before any handler can be reached, and
`extension/src/handlers.ts:168` runs step 3 for each method.

The policy fails closed. An unknown origin is `none`. A non-web address has no origin. A method that
belongs to no feature is refused. `packages/core/src/features.ts:188-194` is the first two steps;
`extension/src/handlers.ts:169` refuses anything the policy does not allow and does not mark
askable.

## 2. The policy is enforced in the extension, not in the bridge

The bridge is the process the agent talks to, so a check that lived there would be a check the
agent's side controls. The decision is made in the extension, in code the agent cannot reach:
`packages/core/src/policy.ts` decides, `extension/src/handlers.ts:168` calls it before every page
access, and the bridge has no call to it — `app/src/bridge/bridge.ts` imports `REQUIRED_LEVEL` for one
thing only, how long to wait for an answer (`app/src/bridge/bridge.ts:126`).

The bridge's own MCP layer refuses to expose a tool that a client marked read-only without
`readOnlyHint: true`, and fails closed by dropping it (`applyReadOnlyGate`, called in
`app/src/frontends/mcp/server.ts`). The gate itself is `@gjsify/mcp`'s since 0.54.0 — it was this
repository's own `runtime.ts`, the third verbatim copy of postbote's, until then — and
`app/tests/unit/mcp/gate.test.ts` pins the direction it compares in, because a gate this
repository does not own is the one case where "it was tested here once" stops being evidence.

**Not verifiable in code:** what the operator of the bridge does outside this repository. If you run
a bridge someone else built, that code decides what the agent may ask for. The statement above is
about Beifahrer's own bridge, which is this repository.

## 3. The bridge listens on your machine only, and only for this extension

The bridge binds `127.0.0.1` — the loopback interface, which is not reachable from the network
(`app/src/bridge/bridge.ts:156`). A connection is refused **in the handshake, before a socket
exists**, unless both hold: the peer address is a loopback address
(`packages/core/src/protocol.ts:548`) and the handshake's `Origin` is a browser extension origin —
`moz-extension:`, `chrome-extension:`, `ephy-webextension:` or `safari-web-extension:`
(`packages/core/src/protocol.ts:582`, used at `app/src/bridge/bridge.ts:161-162`). A web page cannot
put one of those origins on a WebSocket handshake, so a page on any site that opens
`ws://127.0.0.1:<port>` never reaches the token at all.

The token is compared in constant time (`packages/core/src/protocol.ts:570`).

The extension only ever builds `ws://127.0.0.1:<port>/`, with the port taken from its own configured
range (`extension/src/bridge-client.ts:141`). There is no host, no name, no configuration value that
could point it elsewhere.

## 4. Nothing leaves your device

There is no telemetry, no analytics, no crash reporting, no update pings, and no remote endpoint of
any kind. The only network connection the extension opens is the loopback socket above.

This is checkable, and the check is worth doing again after any change:

- the only `WebSocket` in the extension is the loopback probe above
  (`extension/src/bridge-client.ts:141`);
- the only `fetch` in the whole extension is `page.download`, which fetches a document **the page
  you are already on links to**, from **that same origin**, in that page's own session
  (`extension/entrypoints/page-agent.ts:1354`; the same-origin rule is
  `packages/core/src/download.ts:40`). It reads; it never submits anything, and the bytes come back
  over the loopback socket rather than being written to your disk
  (`extension/entrypoints/page-agent.ts:1321-1331`);
- there is no `XMLHttpRequest` and no `navigator.sendBeacon` anywhere in the extension;
- the bridge contains no `fetch`, no `XMLHttpRequest` and no `sendBeacon` either (`app/src`);
- the only `http(s)://` literals in the extension source are the browser's own host-permission
  patterns (`extension/src/settings.ts:95`, `extension/src/network.ts:196`), one `example` origin in
  the end-to-end test seed (`extension/src/e2e-seed.ts:55`), and a comment
  (`extension/src/settings.ts:79`).

**You are the only party to any of it.** The bridge is your process, on your machine, reading your
extension's storage and your browser.

### What the extension declares

For the Firefox build the manifest declares `data_collection_permissions: { required: ['none'] }`
(`extension/manifest.ts:151`), Mozilla's category for "nothing leaves the device". That claim is
consistent with the code above and with the whole of section 4: the only channel the extension has is
the loopback socket, and the bridge it reaches is the one you started.

## 5. Where your data lives

Everything Beifahrer knows is in **your browser profile**, in the extension's own storage. Nothing
is written to the bridge's storage, and nothing is sent to a server.

| What | Where | Code |
|---|---|---|
| your per-site policy, feature switches, pause state, token, port | `storage.local` of this profile | `extension/src/settings.ts:45-70`, written at `extension/src/settings.ts:73` |
| temporary grants ("all sites", "for this session") | `storage.session` — never in the stored policy, gone when the browser restarts | `extension/src/grants.ts:6` |
| the activity log you see in the popup | `storage.session` where the browser has it, otherwise memory only | `extension/src/activity.ts:7-8` |
| saved sessions (your windows and tabs) | `storage.local` of this profile, **never on the bridge** | `extension/src/sessions-store.ts:4-5`, read at `extension/src/sessions-store.ts:38` |
| the request log, when you switch it on | in memory, one buffer per tab, capped at 200 rows, dropped when the tab closes or has been quiet for ten minutes | `extension/src/network.ts:52,73-77,89-95` |

Saved sessions living in the browser rather than beside the agent is a decision with its own
rationale, [ADR 0004](../adr/0004-sessions-live-in-the-browser.md).

What the activity log holds: the time, the method in words, the **host**, the outcome, and a capped
preview of a fill. Never page text (`extension/src/activity.ts:5-6`).

## 6. What the agent can see, and what it cannot

- **A tab on a site you have not allowed shows its host only** — no title, no path, no query string.
  `packages/core/src/redact.ts:53-55` adds the URL and the title only when the site is above level
  `none`. A bank's tab stays "a tab on the bank", never "Statement — balance …".
- **A frame is judged on its own origin, not the page's.** An embedded page from a site you have not
  allowed is never asked about, so it is invisible in the outline, in reading and in finding, while
  the page around it stays readable. Granting a site does not grant what that site embeds.
- **Changes are shown to you before they happen.** Filling a field, clicking, selecting, ticking a
  box, pressing a key and closing a tab each open a window naming the site and the element. You can
  answer it or let it time out, and a timeout is a refusal.
- **Below the level you set, Beifahrer may ask you on the spot.** If you raise a site's level in a
  click, or an agent asks for something below it, a window names the origin and the level needed, and
  the answer can be once, for this session, always, or no. A site you blocked is never asked about,
  and there is no answer that is remembered for a site you blocked
  ([ADR 0010](../adr/0010-temporary-access-and-asking-on-demand.md),
  `packages/core/src/policy.ts`). You can switch asking off entirely, in which case a request below
  the level is refused at once.
- **A frame embedded page is named as such**, so the words never name the top site by accident
  (`extension/src/page-indicator.ts`, the `pill_reading_frame` / `pill_editing_frame` strings in
  `extension/_locales/en/messages.json`).
- **Only you resume.** Pause refuses every method, listing tabs included. The popup, the options
  page, the in-page Stop button and a keyboard shortcut set it; only the popup, the options page and
  the shortcut clear it. No method an agent can call touches it
  (`packages/core/src/features.ts:190`; [ADR 0005](../adr/0005-the-person-sees-and-stops-the-agent.md)).
- **The agent can see the agent is in the page.** A small pill appears in the tab while it is working
  and disappears about three seconds after it stops, and immediately before any screenshot
  (`extension/src/page-indicator.ts:11`, `extension/src/page-indicator.ts:117`, and
  `extension/src/handlers.ts:1056` which hides it before capturing). The pill lives in a **closed**
  shadow root (`extension/src/page-indicator.ts:46`), so the page cannot read its text, and a script
  running in the page cannot remove it.

## 7. Why the permissions are asked for one origin at a time

A WebExtension host permission is a browser-level, all-or-nothing grant. Requesting every site up
front would be the one thing this project must never do: it would make the install prompt — the one
moment a person can actually say no — a list of nothing.

So Beifahrer declares **no** host permissions in the install prompt at all. All three patterns are
optional (`extension/manifest.ts:26`, wired at `extension/manifest.ts:114` for Manifest V3 and
`extension/manifest.ts:120` for Manifest V2):

- `http://*/*` + `https://*/*` — the temporary "all sites" grant, requested from the popup and removed
  when it ends (`extension/src/settings.ts:95`, `extension/entrypoints/popup/main.ts:202`), so that
  ending one grant cannot silently take another away
  ([ADR 0010](../adr/0010-temporary-access-and-asking-on-demand.md))
- `<all_urls>` — the browser's own requirement for screenshots
- one pattern per origin, requested **in the click that raised that origin's level**
  (`extension/entrypoints/popup/main.ts:174`) or **in the click that answered an access prompt**
  (`extension/entrypoints/confirm/main.ts:134`)

Every grant is checked at the moment of use, and the browser's grant is a second fence behind your
policy, not a replacement for it (`extension/src/handlers.ts:176`; the reason the policy — exact
origin, port included — rather than the browser's per-host grant is the gate is written down at
`extension/src/settings.ts:76-83`).

A temporary grant gives the host access back when it ends
(`extension/src/grants.ts:145`).

## 8. The optional permissions, and what each one buys

None of these is granted at install. Each is requested in the same click that switches the feature
on, and the switch stays off if you say no.

| Permission | What it buys | Asked where | Why it is not up front |
|---|---|---|---|
| `webRequest` | **See page requests** — a log of what a page requested, with timings. Off by default. | `extension/entrypoints/options/main.ts:203` | a request log of everything your browser does is a browsing history with timestamps, and unlike a host permission it **cannot** be narrowed to one site — there is no per-origin form of it (`extension/manifest.ts:29-38`, `packages/core/src/features.ts:101-105`) |
| `<all_urls>` | **Screenshots** — the browser's `captureVisibleTab` accepts nothing narrower, and Firefox does not even define it without the grant. Off by default. | `extension/entrypoints/options/main.ts:172` | the browser's own API has no narrower form (`extension/manifest.ts:21-23`, checked per call at `extension/src/handlers.ts:1039`) |
| `http://*/*` + `https://*/*` | **Saved sessions and tab management** — saving, restoring, sorting, pinning, closing, grouping windows and tabs. Off by default. | `extension/entrypoints/popup/main.ts:202` | a session is a list of your tabs, so this is your browsing history; it belongs behind a switch you set, not in the install prompt |
| `webRequest` + `script` feature | **Running the agent's own script in a page** — off by default, needs the `write` level, and **always** asks, showing you the whole script | `extension/entrypoints/confirm/main.ts:134`; `packages/core/src/policy.ts:219` | a script is code you have not read running in a page you are logged into; it gets its own switch, and no setting can silence it ([ADR 0012](../adr/0012-running-the-agents-own-script-in-the-page.md)) |

The remaining declared permissions need no prompt and touch no site by themselves: `tabs`, `storage`,
`alarms`, `sessions`, `tabGroups` (`extension/manifest.ts:92`) — and the capabilities behind
`sessions` and `tabGroups` are off by default
(`packages/core/src/features.ts:114-115`).

## 9. What the extension does not do

- It does not read your bookmarks, history, downloads, cookies or saved passwords.
- It does not read the clipboard.
- It does not modify pages you are not working on, and it does not install anything into them.
- It does not switch the tab you are looking at. A screenshot refuses a tab that is not the visible
  one (`extension/src/handlers.ts:1049-1054`).
- It does not fill a password field: the page agent refuses the call by name
  (`extension/entrypoints/page-agent.ts:830-836` for a fill, `extension/entrypoints/page-agent.ts:943-949`
  for a typed key press).
- It does not run code in a page's own JavaScript world. A Manifest V3 content script cannot compile
  a string into code at all, so `page_evaluate` works in the Firefox build and answers
  `unsupported` on Chromium and Safari
  (`extension/src/handlers.ts`, the `unsupported` branch of `page.evaluate`; the probe is at runtime,
  never inferred from a manifest field).
- It does not send you to a server to install anything: the extension does not update itself.
- It is not obfuscated, and its source is the repository this statement lives in.

## 10. Children and sensitive sites

Beifahrer is a developer tool. It is not directed at children, and no age gate is claimed.

You can block a site outright — a tab on it then shows its host only and nothing may be read or
changed on it, and a block is not overridden by a temporary grant. Do that for a banking, health or
employer site, and remember that a frame embedded from another origin is judged separately, so a
block on the top site does not cover what the page embeds.

## 11. Changes to this statement

This file is the statement. If a future version changes what the extension does, this file changes
with it, in the same commit — the claims are `file:line` citations precisely so that a change to the
code makes the statement visibly wrong rather than quietly stale.

Contact: the support address in the store listing. *(A person must supply it — see
[README.md](README.md).)*

---

## A human decision remains in three places

1. **The URL to publish this at.** Chrome, Edge and AMO all require a URL that resolves. None exists
   in the repository.
2. **The support contact**, named at the end and required by AMO's form.
3. **Whether to say anything about the bridge operator's side.** Section 2 marks what is not
   verifiable in this repository. If Beifahrer will be shipped with a bridge someone else built, that
   paragraph needs to become a promise someone else keeps, and a person has to decide whether this
   project can make it.
