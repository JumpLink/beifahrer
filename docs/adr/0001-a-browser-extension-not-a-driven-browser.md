# 0001 — A browser extension in the browser you already use, not a browser the agent drives

- **Status:** accepted
- **Date:** 2026-09-25

## Context

An AI agent working next to a person keeps needing the browser that person already has open:

- **See what they see** — which tab is in front, which tabs are open — without the person copying
  URLs into a chat.
- **Use their sessions** — fetch an invoice from a shop account, a letter from a bank's online
  inbox, a notice from a health-insurer portal. The person is already logged in, often through
  an app-based second factor that no automation should hold.
- **Change text they are looking at** — rewrite an issue description or a comment in a web
  tracker, in place, where the person can see and undo it.
- **Test** a web app in more than one engine (Gecko, Blink, and — where it works — WebKitGTK).

The person's everyday browser is mostly **Firefox**.

### What exists (surveyed 2026-09-25)

| Tool | Reaches the person's session | Engines | Why it is not enough |
|---|---|---|---|
| Playwright MCP, `--extension` mode | yes | Chromium | Chromium only |
| Chrome DevTools MCP (`--autoConnect`) | yes | Chromium | Chromium only, needs remote debugging switched on |
| Claude in Chrome | yes | Chromium | Chromium only, bound to one vendor's agent |
| [browser-control-mcp](https://github.com/eyalzh/browser-control-mcp) | yes | Firefox | deliberately read-only: no scripting, no page changes — cannot edit a comment |
| Playwright / WebDriver | **no** — launches its own profile | all | no sessions, no "what am I looking at" |

browser-control-mcp's **per-domain consent in the browser** is the right idea and is adopted
below. None of these covers Firefox *and* Chromium *and* writing *and* a policy the person
controls.

## Decision

Build **beifahrer**: a WebExtension (for Firefox, Chromium and,
where it works, Epiphany) plus a local bridge that exposes it to agents as an **MCP server**.

```
Firefox / Chromium / (Epiphany)
  └─ beifahrer extension — background + on-demand content script
       ⇅ WebSocket, 127.0.0.1 only, paired with a token
beifahrer bridge  — MCP server over stdio
       ⇅
agent
```

### 1. The extension connects out; the bridge listens on loopback

The bridge listens on `127.0.0.1` and the extension connects to it. A WebSocket from an extension
background works in every target engine; **native messaging does not** (Epiphany implements none)
and would also tie the bridge's lifetime to the browser's.

A web page can open a WebSocket to `127.0.0.1` too. The bridge therefore accepts a connection only
when **both** hold:

- the handshake's `Origin` is an extension origin (`moz-extension://`, `chrome-extension://`,
  `ephy-webextension://`) — a page cannot forge that header; and
- the first message carries the **pairing token** the bridge printed, which the person pasted into
  the extension's options once.

### 2. The browser is where the policy lives and is enforced

Every origin has a level, chosen by the person in the extension:

| Level | The agent may |
|---|---|
| `none` (default) | nothing. In a tab list the tab appears as its host only — no title, no path. |
| `read` | read the page text, a structured outline, a screenshot of the visible area |
| `write` | additionally fill fields and click — **each write is confirmed** by the person in a browser-owned window, unless they set that origin to `write` *without asking* |

**Default is `none`, fail-closed.** The check runs in the extension, not in the bridge: the bridge
is the component an agent talks to, so it is the one that must not be trusted to hold the gate.
A request the policy does not allow returns an error naming the origin and the level it would
need, so the agent can ask the person instead of retrying.

This matters most for the sessions this tool exists to use. An agent reading a bank inbox is
reading content a third party wrote — the classic prompt-injection path. Keeping banking origins
at `read` means an injected instruction has nothing to write with.

### 3. Engine support is measured, not claimed

Epiphany was measured on 2026-09-25 with a probe extension:

| | Epiphany 50.6 (Fedora Flatpak) | Epiphany master (Nightly Flatpak, "51.0") |
|---|---|---|
| Engine | Epiphany's own WebExtension implementation, MV2 only | migrating to WebKit's native WebExtension engine |
| Background page runs | yes — WebSocket and `fetch` to `127.0.0.1` work | **no**, for all five manifest variants tried, and silently |
| Stability | **the UI process aborts ~1 s after start** with any extension active — [#2801](https://gitlab.gnome.org/GNOME/epiphany/-/work_items/2801), fixed only on main (49b37a7, 2026-09-10), not in 50.6/51.0/51.1 | stable |

From Epiphany's source: `tabs.executeScript` (main frame only), `tabs.query/create/update/remove`,
`tabs.sendMessage`, `windows.*`, `cookies`, `downloads` exist; `tabs.captureVisibleTab`,
`scripting`, `webNavigation`, `webRequest`, native messaging and `runtime.connect` do not; of the
tab events only `onCreated`/`onRemoved` actually fire.

So **Firefox and Chromium are the v1 targets**. Epiphany is a *degraded tier* — MV2, no
screenshots, polling instead of events — switched on only once a released Epiphany passes the
probe (`probes/epiphany/`). Bugs found on the way are reported upstream, not worked around here.

### 4. Where it sits next to abholer

[abholer](https://github.com/JumpLink/abholer) fetches the person's own documents from portals and
decided to attach to a running Chrome over CDP. beifahrer is a second transport for exactly that
pattern — the person logs in, the tool attaches afterwards, no credential is ever held — that also
reaches **Firefox**. abholer stays read-only towards every provider; beifahrer's `write` level is
for the person's own tools (trackers, wikis), never something abholer asks for.

## Consequences

- Two manifest flavours from one source: MV3 (Chromium; background is a service worker that
  sleeps when idle, so the socket carries a keep-alive) and MV2 (Firefox, Epiphany; a background
  page). One build script produces both — see [ADR 0002](0002-build-on-gjs-not-wxt.md), which replaced
  the original WXT build.
- `scripting.executeScript` (MV3) and `tabs.executeScript` (MV2) sit behind one adapter.
- Everything an agent can do is enumerated in the protocol package; nothing is "run arbitrary
  JavaScript". An `evaluate` escape hatch would make the policy table above meaningless.
- One bridge owns the port. A second agent session that starts its own bridge gets a clear
  "port in use" error. Sharing one browser between several agents is future work.
