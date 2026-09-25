# 0005: The person sees the agent, and can stop it

- **Status:** accepted. Replaces ADR 0004's single "manage tabs" switch with two features.
- **Date:** 2026-09-25

## Context

The per-site levels decide *where* the agent may read or write. They do not tell the person
*that* an agent is in the browser right now, and they give no way to stop it in one move: the
person would have to lower every site, or kill a process they may not know about. The person
asked for two things: to **see** when the agent is in the browser, and to **stop** it, plus a list
of which capabilities may be used at all.

Options considered for stopping:

| Option | Why not |
|---|---|
| Disconnect the socket | the bridge reconnects within a second, and the agent only sees "no browser", not "the person said stop" |
| Lower every site to Nothing | loses the person's settings; tab listing still works |
| A pause the bridge can also lift | the bridge is the agent's side (ADR 0001). A stop the agent can undo is not a stop |

## Decision

### 1. Pause: a kill switch in the browser, lifted only there

`paused` in the extension's `storage.local`. While it is set, **every** method, `tabs.list`
included, answers the wire error `paused` with "the person paused beifahrer in the browser — ask
them to resume". The person sets it from the popup's switch, the options page, the **Stop** button
of the in-page pill and the `toggle-pause` command (Alt+Shift+B, ⌥⇧B on macOS).

It is lifted **only from the browser's own UI**: the popup, the options page, the shortcut. No
protocol method touches it, and the one message a content script may send the background
(`beifahrer-stop`) can only set it. A stored value that is not a boolean counts as paused.

### 2. Features: one switch per capability

`packages/core/src/features.ts` holds the table. `FEATURE_OF` maps every method to exactly one
feature (`satisfies Record<Method, Feature>`, so a method without one does not compile, and
`featureOf` refuses one that got past the type system):

| Feature | Methods | Default |
|---|---|---|
| `tabs` | `tabs.list`, `tabs.active` | on |
| `read` | `page.read` | on |
| `outline` | `page.outline` | on |
| `screenshot` | `page.screenshot` | off |
| `fill` | `page.fill` | on |
| `click` | `page.click` | on |
| `open` | `tabs.open` | on |
| `manageTabs` | `tabs.move/pin/close/group/ungroup`, `windows.create` | off |
| `sessions` | `sessions.*` | off |

Reading and ordinary page work are on because the per-site level still gates them, and writes
still need `write` on the site plus, by default, the person's confirmation. The three that are off
reach past the one site the person set a level for. A refusal is the wire error
`feature_disabled`, naming the feature. Stored switches are parsed fail-closed: only a literal
`true` switches one on, and a stored value that is not an object switches all off.

This replaces ADR 0004's `REQUIRED_GRANT` / `decideGrant`. One mechanism, not two: its stored
`grants.manageTabs = true` still switches **both** `manageTabs` and `sessions` on (it covered
both), until the person sets either feature. The screenshot feature is beifahrer's own policy on
top of the browser's `<all_urls>` grant, which stays a separate opt-in in the options page.

### 3. The check order

`runMethod` (extension/src/handlers.ts) calls `preflight` (core) before any handler, so no
handler can skip it:

1. paused → `paused`
2. feature off → `feature_disabled`
3. per-site level → `forbidden`
4. the browser's host grant → `forbidden`
5. confirmation for writes → `denied`

### 4. What the person sees

- **Toolbar icon**, sparkles drawn from one SVG (`extension/icons/sparkles.svg`, rendered by
  `extension/scripts/icons.ts` on GJS through GdkPixbuf/librsvg): grey when connected and idle,
  in colour while a request runs and for 5 s after, a red dot while paused, an amber dot when not
  paired or no bridge is running. The tooltip says it in words. `toolbarLook` (core) is the pure
  mapping; badge text is only the fallback for a browser without `setIcon`.
- **Popup**: the pause switch, the site's level, the features, and the last 20 requests: time,
  method in words, host, outcome, and for a fill the first 40 characters the agent typed. Never
  page text and never a path. Held in memory and `storage.session`, never on disk.
- **In-page pill** while `page.read/outline/fill/click` runs: in a closed shadow root on a host
  element outside `<body>`, fixed, top z-index, pointer events only on its Stop button, gone
  3 s after the last action and hidden before every screenshot. The page sees an empty element
  come and go and nothing else. It is shown only where the page agent already runs, which is a
  site the policy let in.

## Consequences

- The agent can tell "the person said stop" (`paused`), "the person does not want this kind of
  thing" (`feature_disabled`) and "not on this site" (`forbidden`) apart, and each message tells
  it to ask rather than retry.
- A page can notice that an agent is working on it (the host element). The alternative, working
  unseen, is what the person asked to end.
- The e2e cannot click the popup, so it builds the extension three times: default features (the
  refusals), PR #8's legacy grant plus screenshots (the migration), and paused (all 21 tools
  answer `paused`). The pill is checked from the page's side: a fixture script records the host
  element coming and going and that its shadow root is closed.
- The extension build needs GdkPixbuf and librsvg's loader for the icons (CI installs
  `gdk-pixbuf2 librsvg2`).
