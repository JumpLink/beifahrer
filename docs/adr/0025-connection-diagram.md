# 0025: One connection diagram for the window and the popup

- **Status:** proposed (design only — nothing in `app/` or `extension/` is changed by this PR)
- **Date:** 2026-11-03
- **Asked for by:** the person, 2026-11-03: a picture of "AI app ⟷ Beifahrer ⟷ browser" in both
  halves of the product, instead of one big symbolic icon on the Status page that says `ready` and
  nothing about which of the two connections is the broken one.
- **Relates to:** [0007](0007-one-connection-per-agent-session.md) (one bridge per agent session,
  started by the agent), [0014](0014-not-connected-speaks-first.md) (the ladder both halves walk),
  [0015](0015-session-registry.md) (what the window may read), [0023](0023-onboarding-for-beginners.md)
  (the setup assistant the failing first link links to),
  [0024](0024-the-window-stays-in-the-background.md) (the Status page this replaces an icon on)

## Context

The Status page shows one `Adw.StatusPage` icon for all of `no-bridge`, `no-browser` and `ready`
(`app/src/window/status-model.ts`, `ICON`), and the popup shows one word and one dot
(`extension/src/ui/status.ts`). Both are honest about the rung and silent about the shape: there are
**two** connections in a row, they fail for different reasons, and the fix for each lives in a
different place. A person who sees "No browser connected" has to already know that Beifahrer is not
a server they can restart, that the agent started it, and that the token they need is in the other
half of the product.

The second thing the two words hide is that neither half sees the whole chain. The window reads the
registry (ADR 0015) and therefore sees sessions and their browsers, but never a token, a pause or a
refusal. The extension holds the sockets and therefore sees refusals, protocol mismatches and its
own pause, but has no view of any agent process — only of a port that answered or did not. A single
drawing used by both must say which end is looking, and must not claim knowledge the looking end
does not have.

A third misconception is worth drawing away: Beifahrer's window is not the bridge. The agent starts
`beifahrer mcp` over stdio, that process binds a port and announces itself; the window only watches
the registry directory. A picture that puts the window in the middle of the chain would teach
exactly the model ADR 0003 was abandoned for.

## Decision

### 1. One drawing, three nodes, two links

    [ AI app / MCP client ]  ──link 1──  [ Beifahrer ]  ──link 2──  [ browser ]

Both links carry state; **the nodes never do**. A node is dark furniture in both palettes, which is
what keeps green meaning "this connection works" and nothing else.

Beifahrer's node is the **bridge of this agent session**, not the window — § 7 says how the artwork
makes that one thing, and § 3 says what each viewpoint may claim about it.

### 2. Which node is "you"

The reader's own node carries a **ring in the accent colour and a label** ("This app" in the window,
"This browser" in the popup); it is never filled green. Class `here-window` draws the ring around
Beifahrer, `here-extension` around the browser. The own node is *marked*, not *praised*: being the
app you are looking at is not a health state.

### 3. The states, from both ends

The state set is not invented here; it is what the code already distinguishes. Four link states,
because four is what both sides can actually produce:

| class | line | mark | means |
|---|---|---|---|
| `l*-ok` | solid | ✓ tick | the two ends are talking |
| `l*-wait` | dashed, wide gaps | ⋯ three dots | one end is trying; give it a moment |
| `l*-fail` | broken, gap in the middle | ✕ cross | it is not going to fix itself |
| `l*-unknown` | faint dotted | ? question mark | this end cannot see that far |

**Link 1 — AI app ⟷ Beifahrer**

| source state | window (registry) | extension (socket) |
|---|---|---|
| a bridge is registered and fresh (`updatedAt` within `STALE_MS` = 15 s) | `ok` | `ok` — only for the ports it is welcomed on |
| the bridge is binding, or the MCP client has not introduced itself yet (label still `mcp`, before `oninitialized`) | `wait` | `wait` |
| no registry entry at all (`Presence = 'no-bridge'`) | `fail` → `status.nobridge` | **cannot distinguish** from "wrong token": sees only a port that did not answer → `fail`, with the extension's own wording |
| a registry file could not be read (`skipped` > 0, `note`) | `unknown` | — |
| something listens on a Beifahrer port that no session announced (`unregisteredPorts`) | `unknown` + the existing warning row | — |
| the extension's background has not answered yet (`connection === undefined`) | — | `unknown` (today this collapses into `unpaired`; § 9 lists the one-line change) |

**Link 2 — Beifahrer ⟷ browser**

| source state | window (registry) | extension (socket) |
|---|---|---|
| a session has at least one connected browser (`Presence = 'ready'`) | `ok` | `ok` (`Overall = 'connected'`) |
| the socket is opening (`PortEntry.state = 'connecting'`) | **cannot see it** — a session with no browser looks the same either way → `fail` | `wait` |
| session running, no browser (`Presence = 'no-browser'`) | `fail` → `status.nobrowser` | — |
| the bridge refused the token (`CLOSE.unauthorized` → `Overall = 'unauthorized'`) | **never sees it** — a refusal is not written to the registry | `fail` |
| protocol mismatch (`CLOSE.protocol` → `Overall = 'protocol'`) | **never sees it** | `fail` |
| nothing paired yet (`unpaired`) | — | `fail` |
| the person paused this browser | **never sees it** (ADR 0015 § 5: the bridge is not told) | badge on the browser node, not a link state |
| a request is in flight (`working`, `ACTIVE_MS`) | — | optional pulse on link 2; out of scope for this PR (§ 11) |

Two rows above are the point of the whole exercise: the window calls a connecting browser a failure
and cannot name a refused token at all. Both are honest gaps, both are drawn as such, and § 9 does
not pretend to close them — closing them means sending extension state back to the bridge, which is
a separate decision.

### 4. Colour is never alone

Every state differs in **three** ways: colour, line geometry, and a glyph with a word beside it. A
`fail` link is red, broken, crossed and captioned; in greyscale, with any colour blindness, or in a
screenshot at thumbnail size, two of the three still carry. Adwaita's palette only: green `#26a269`,
yellow `#e5a50a`, red `#e01b24`, grey `#77767b` on light; `#33d17a`, `#f6d32d`, `#f66151`, `#9a9996`
on dark; the accent ring `#613583` / `#d9c2f0`.

### 5. A failing link says what to do, once

Under the diagram, the host draws **one plain sentence and at most one button** — the loudest
failing link, in ADR 0014's order (link 2 before link 1 in the popup, because that is the end the
person is looking at; link 1 before link 2 in the window, because a missing session makes the
browser question moot).

| where | state | sentence | button |
|---|---|---|---|
| window | link 1 `fail` | "No agent session is running. Set Beifahrer up in your AI app, then start it." | **Set up your app** → the setup assistant (ADR 0023) |
| window | link 2 `fail` | "A session is running, but no browser is connected. Open the browser and enter the pairing token." | **Show the token** → the Browser page |
| popup | link 2 `fail` / `unpaired` | "This browser is not paired yet. Enter the pairing token from the Beifahrer window." | **Enter the token** (existing `action_pair`) |
| popup | link 2 `fail` / `unauthorized` | "Beifahrer refused this token. Enter the current one from the Beifahrer window." | **Enter the token** |
| popup | link 2 `fail` / `protocol` | "The extension and Beifahrer are different versions. Update both to the same one." | *(none — a link to the release page)* |
| popup | link 1 `fail` | "No agent session answered. Start your AI app, or restart it if it was already running." | **Restart your AI app** *(opens help; the extension cannot start a process)* |

The last row is deliberately a help link and not an action: the extension has no way to start an
agent, and a button that lies is worse than a sentence that does not.

### 6. More than one session

Several agent sessions are several bridges (ADR 0007), so the AI-app node **stacks**: `stacked-2`
and `stacked-3` draw one and two cards behind the front one, and the host writes the names it knows
beside it — "opencode, LM Studio ⟷ Beifahrer ⟷ Firefox". Beyond three the host writes "+ n more";
the artwork does not grow. Several browsers do the same on the right in the window's view, from
`BridgeStatus.browsers`.

### 7. The shared asset: `data/diagram/connection.svg`

One file, a sibling of `data/icons/` and `data/achievements/`, which is already the repo's place for
artwork two halves of the product both draw. The app compiles it into its GResource; the extension
build copies it into its bundle the way it already copies the achievement artwork.

Two properties make the sharing work:

- **No text in the file.** Every word is drawn by the host beside the artwork, out of its own
  catalogue (`app/locales/*.json`, `extension/_locales/*/messages.json`). That is the rule
  `data/achievements/*.svg` already follows, and it is the reason one 480×140 artwork serves the
  window's 640 px clamp and the popup's 360 px body without a second layout: the labels reflow, the
  picture scales.
- **State is a class list on the root**, never a second file:
  `l1-ok|l1-wait|l1-fail|l1-unknown`, `l2-…`, `here-window|here-extension`, `paused`,
  `stacked-2|stacked-3`, `dark`.

The Beifahrer node is the **app icon itself, spliced in by the build** from
`data/icons/hicolor/scalable/apps/eu.jumplink.beifahrer.svg`, in colour. Splicing rather than
redrawing means the bus in the diagram can never drift from the bus on the launcher, and in colour
rather than monochrome because the monochrome bus is the toolbar's *idle* look — using it here would
say "nothing is happening" in a picture whose whole job is to say what is happening.

Two constraints came out of rasterising it, both measured on librsvg 2.62 / glycin on 2026-11-03:

- **No CSS custom properties.** librsvg does not implement `var()`; the first render came out
  entirely black because every colour resolved to its initial value. Literal hex only, with the dark
  palette as a second rule block under `#diagram.dark`.
- **`dark` is a class, not `prefers-color-scheme`.** librsvg resolves no media query either, so the
  window would have stayed light forever while the popup switched. One mechanism for both halves:
  set from `Adw.StyleManager` in the app, from `matchMedia` in the extension.

Class selectors and `display` do work, which is what the switching is built on.

### 8. The protocol addition: the bridge names its MCP client

The extension already learns a session's label after the fact: the MCP client introduces itself in
the handshake, `oninitialized` calls `handle.relabel(name)` (`app/src/frontends/mcp/server.ts`), the
bridge sends `{ type: 'session', label }` and `ConnectionTable.relabelled()` stores it. So the
popup can already write "claude-code · werkstatt" beside the left node — but only the *label*, a
display string that also carries the working directory, and only when the rename happens to fire.

For the diagram the extension needs one more fact: **is an MCP client attached to this bridge at
all**, which is exactly the difference between link 1 `ok` and link 1 `wait`. A bridge binds its
port before any client has initialised; today both look identical from the browser.

The addition is one optional field on the existing frame, not a new frame:

```ts
// packages/core/src/protocol.ts
export type BridgeFrame =
  | Welcome
  | Request
  | { type: 'pong' }
  | { type: 'session'; label: string; client?: McpClient | null }
  | { type: 'desktop'; desktop: DesktopInfo };

/** The MCP client on the other end of this bridge's stdio, as it named itself in the handshake. */
export interface McpClient {
  /** `clientInfo.name`, cleaned like a session label: "claude-code", "LM Studio". */
  name: string;
  /** `clientInfo.version`, if it sent one. */
  version?: string;
}
```

`Welcome` gains the same optional field, so a browser that connects to an already-initialised
bridge learns it without waiting for a rename:

```ts
export interface Welcome {
  …
  session?: AgentSession;
  /** Absent from bridges older than ADR 0025; `null` means "bound, nobody initialised yet". */
  client?: McpClient | null;
}
```

**Backwards compatibility, both directions.** The field is optional and parsed fail-closed, in the
shape `parseWelcome` already uses for `session` and `desktop`:

- *Old bridge, new extension.* `client` is `undefined`. The extension draws link 1 `unknown`, not
  `fail` — it has no evidence either way, and the question-mark state exists precisely for this.
  It never refuses the bridge over a missing field.
- *New bridge, old extension.* The extra property on a frame it already parses is ignored; nothing
  in `parseWelcome` or the `session` branch of `bridge-client.ts` rejects unknown keys.
- *Bad value.* `parseMcpClient` returns `null` for anything that is not an object with a non-empty
  string `name`; a `null` is dropped exactly like a bad `desktop` is dropped today — cosmetic, never
  a reason to close the socket. The name runs through the same `cleanSessionLabel` filter (C0/C1,
  DEL, bidi marks) and the same `SESSION_LABEL_MAX`, because a client that names itself is a client
  that can try to pose as another.
- *Protocol version.* Unchanged at 1. An optional field that both sides may ignore is not a break,
  and bumping it would refuse every existing peer for a label.

The bridge sends `{ type: 'session', … }` with `client` on `oninitialized` (the rename it already
does) and with `client: null` on a client that disconnects, so the picture falls back to `wait`
rather than lying `ok` forever.

### 9. What each half has to compute

Nothing in this PR implements any of it. For the record, the mapping each host needs:

- **Window** — `viewOf` (`app/src/window/status-model.ts`) gains a `links: { l1: LinkState; l2:
  LinkState }` beside the existing `presence`, derived from the same `RegistryStatus` plus
  `skipped` and `unregisteredPorts`. Nothing new is read; the Status page swaps its
  `Adw.StatusPage` icon for the artwork.
- **Extension** — `stateOf` (`extension/src/ui/status.ts`) keeps its `UiState` as the word; the
  diagram needs a second, smaller function over the same input, `linksOf(connection, client,
  paused)`. The one behaviour change it would want is to stop collapsing "background has not
  answered yet" (`connection === undefined`) into `unpaired`, so link 1 can be `unknown` instead of
  red on the first paint.

### 10. The strings

Window (`app/locales/en.json`, `de.json`) — the three `status.*` pairs stay as they are and become
the heading above the diagram. New:

| key | en | de |
|---|---|---|
| `diagram.node.app` | Your AI app | Deine KI-App |
| `diagram.node.beifahrer` | Beifahrer | Beifahrer |
| `diagram.node.browser` | Your browser | Dein Browser |
| `diagram.here.window` | This app | Diese App |
| `diagram.here.extension` | This browser | Dieser Browser |
| `diagram.link.ok` | Connected | Verbunden |
| `diagram.link.wait` | Connecting… | Verbindet… |
| `diagram.link.fail` | Not connected | Nicht verbunden |
| `diagram.link.unknown` | Not visible | Nicht sichtbar |
| `diagram.more` | + {count} more | + {count} weitere |
| `diagram.fix.nobridge` | No agent session is running. Set Beifahrer up in your AI app, then start it. | Es läuft keine Agent-Sitzung. Richte Beifahrer in deiner KI-App ein und starte sie. |
| `diagram.fix.nobridge.action` | Set up your app | App einrichten |
| `diagram.fix.nobrowser` | A session is running, but no browser is connected. Open the browser and enter the pairing token. | Eine Sitzung läuft, aber kein Browser ist verbunden. Öffne den Browser und gib das Kopplungs-Token ein. |
| `diagram.fix.nobrowser.action` | Show the token | Token anzeigen |
| `diagram.fix.unreadable` | A session file could not be read, so this may be out of date. | Eine Sitzungsdatei war nicht lesbar, das Bild kann veraltet sein. |

Extension (`extension/_locales/*/messages.json`) — `state_*` and `banner_*` stay; the banner text
moves under the diagram. New, same values for the five shared keys (`diagram_node_app`,
`diagram_node_beifahrer`, `diagram_node_browser`, `diagram_here_extension`, `diagram_link_*`), plus:

| key | en | de |
|---|---|---|
| `diagram_fix_unpaired` | This browser is not paired yet. Enter the pairing token from the Beifahrer window. | Dieser Browser ist noch nicht gekoppelt. Gib das Kopplungs-Token aus dem Beifahrer-Fenster ein. |
| `diagram_fix_unauthorized` | Beifahrer refused this token. Enter the current one from the Beifahrer window. | Beifahrer hat dieses Token abgelehnt. Gib das aktuelle aus dem Beifahrer-Fenster ein. |
| `diagram_fix_protocol` | The extension and Beifahrer are different versions. Update both to the same one. | Erweiterung und Beifahrer haben verschiedene Versionen. Bringe beide auf denselben Stand. |
| `diagram_fix_offline` | No agent session answered. Start your AI app, or restart it if it was already running. | Keine Agent-Sitzung hat geantwortet. Starte deine KI-App, oder starte sie neu, wenn sie schon lief. |
| `diagram_fix_paused` | You paused this browser. No agent can act here until you resume. | Du hast diesen Browser pausiert. Bis du fortsetzt, kann hier kein Agent handeln. |

`action_pair` ("Pair…" / "Koppeln…") and `action_resume` already exist and are the buttons under the
first two and the last row.

### 11. The toolbar badge

The toolbar button keeps `alarmOf`'s order and its five looks (`packages/core/src/toolbar.ts`); it
gains nothing new. What changes is only that the dot's colour and the diagram's link 2 are now
visibly the same statement — `LOOK_COLOUR.offline` is `#e01b24`, the same red `l2-fail` draws. Green
for a working connection is added to `LOOK_COLOUR` only if the idle bus ever stops being monochrome;
this ADR does not propose that, because the monochrome idle bus is what tells the person *nothing is
happening right now*, and that is worth more in a toolbar than a second green.

### 12. The style reference and its licence

GNOME's [app-illustrations](https://gitlab.gnome.org/Teams/Design/app-illustrations) was read as a
style reference only — flat shapes, Adwaita palette, a drawing that reads at 48 px. **No artwork
from it is copied, and none is in this repo.** Stating the licence honestly: the repository at
`adf62dfe` (2026-09-02) carries **no LICENSE or COPYING file**, and the GitLab API reports
`license: None`. So it could not have been reused even if we wanted to; everything in
`data/diagram/` is drawn here.

## Consequences

- The Status page stops saying "something is wrong" and starts saying **which half** is wrong and
  **where the fix lives** — and the popup says the same thing in the same picture, so a person who
  learns it in one half already knows it in the other.
- The window's blind spots (a connecting browser, a refused token, a pause) become *visible* blind
  spots, drawn as `unknown`, instead of being silently rendered as something else.
- One more file the extension build has to copy, and one splice step in the app build; in exchange,
  the bus in the diagram cannot drift from the bus on the launcher.
- `client` on the session frame is the first field whose only consumer is a picture. It is optional
  in both directions, so an old half of the product keeps working against a new one.

## Out of scope

- Any code in `app/` or `extension/`. This PR is the ADR and the artwork.
- Animation: no pulse on an in-flight request, no transition between states. A diagram that moves
  while an agent types is a separate decision, and a bad default for anyone who turned animations
  off.
- Per-browser detail in the window (which Firefox, which profile). The session rows already carry
  that; the diagram stays at one browser node, stacked when there are several.
- The MCP client's *icon*. Names only: shipping a logo per AI app is a trademark question and a
  maintenance burden, and it would be the one thing in the picture that needs updating when a new
  client appears.

## Open questions

1. Where the diagram sits on the Status page — replacing the `Adw.StatusPage` icon entirely, or
   above the title with the title kept. The mocks show the first.
2. Whether the popup shows the diagram always, or only when something is not `ok`. Always is honest
   but costs 140 px of a 360 px popup.
3. Whether link 1 `wait` should decay to `fail` after a timeout (a bridge nobody ever initialises),
   or stay amber forever.
