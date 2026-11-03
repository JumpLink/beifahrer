# 0025: One connection diagram for the window and the popup

- **Status:** proposed (design only — nothing in `app/` or `extension/` is changed by this PR)
- **Date:** 2026-11-03
- **Asked for by:** the person, 2026-11-03: a picture of "AI app ⟷ Beifahrer ⟷ browser" in both
  halves of the product, instead of one big symbolic icon on the Status page that says `ready` and
  nothing about which of the two connections is the broken one. Revised the same day after the
  first round of renders: § 2 is now an A/B choice, § 7a adds the phone arrangement, and three
  placements that were open questions are proposed defaults in § 13.
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

### 2. Which node is "you" — two variants, B proposed

Whatever marks the reader's own node, it is never a green fill: being the app you are looking at is
not a health state. The own node is *marked*, not *praised*. `here-window` selects Beifahrer's node,
`here-extension` the browser's. Two ways to draw that mark were rendered side by side:

| | variant A — the ring | variant B — the pill *(proposed)* |
|---|---|---|
| artwork | an accent outline around the node, class `mark-ring` | nothing; the artwork is identical minus that one rect |
| label row 1 | all three node names bold | the own node's name bold, the other two at medium |
| label row 2 | the "This app" / "This browser" word in accent text | the same word as a filled accent pill |

**B is the recommendation.** The first round's three reported collisions — the ring cutting through
the "Firefox" caption, the links running into the box, the whole chain looking cramped — were all
geometry caused by the ring, and the ring buys nothing the words do not already say: the pill
*reads* "This browser" where the outline only implies it. Dropping it also removes the one element
that scales badly, because an outline that must clear a label at 680 px is enormous at 360 px.

Both variants are drawn against the **same geometry**: the ring's footprint — 10 units around every
node — is reserved whether or not it is drawn, and every link stops a further 12 units short of it.
So in variant B each link ends an even 22 units clear of the node it points at, on all four sides,
and choosing the other variant reflows nothing. A link never touches a node, a ring or a label in
either one.

Because the ring is one `<rect>` switched by one class, keeping A as well costs nothing: if the ring
turns out to be wanted later, `mark-ring` turns it back on without a second asset.

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
| a bridge is registered and fresh (`updatedAt` within `STALE_MS` = 15 s) | `ok` | `ok` — only on a port it was welcomed on, and only with `client` present (§ 8) |
| the bridge is binding, or the MCP client has not introduced itself yet (label still `mcp`, before `oninitialized`) | `wait` | `wait` — welcomed, but `client: null` |
| no registry entry at all (`Presence = 'no-bridge'`) | `fail` → `status.nobridge` | `unknown` |
| a registry file could not be read (`skipped` > 0, `note`) | `unknown` | — |
| something listens on a Beifahrer port that no session announced (`unregisteredPorts`) | `unknown` + the existing warning row | — |
| the extension's background has not answered yet (`connection === undefined`) | — | `unknown` (today this collapses into `unpaired`; § 9 lists the one-line change) |

**The extension never draws link 1 `fail`.** It observes one socket — its own, which is link 2 —
and everything it knows about link 1 arrives *through* that socket. With no socket there is no
evidence, and `unknown` is the state that exists for exactly that. So the extension has three
cases and not four: `ok` when welcomed with a `client`, `wait` when welcomed with `client: null`,
`unknown` otherwise — an old bridge, a refused token, a closed socket, nothing paired yet. A red ✕
there would be the picture claiming to have looked where it cannot look, which is the one failure
mode § 3 exists to prevent.

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

The heading above says what is wrong; **the sentence says only what to do**, never the heading again
in longer words. "No agent session running / No agent session is running…" was the first round's
third reported bug, and the rule that prevents it is that the two never share a verb.

| where | state | heading | sentence | button |
|---|---|---|---|---|
| window | link 1 `fail` | No agent session running | "Set Beifahrer up in your AI app, then start it." | **Set up your app** → the setup assistant (ADR 0023) |
| window | link 2 `fail` | No browser connected | "Open your browser and enter the pairing token." | **Show the token** → the Browser page |
| popup | link 2 `fail` / `unpaired` | Not paired | "Enter the pairing token from the Beifahrer window." | **Pair…** (existing `action_pair`) |
| popup | link 2 `fail` / `unauthorized` | Token refused | "Enter the current token from the Beifahrer window." | **Pair…** |
| popup | link 2 `fail` / `protocol` | Versions differ | "Update the extension and Beifahrer to the same version." | *(none — a link to the release page)* |
| popup | link 1 `wait` | Waiting for your AI app | "Start a session in your AI app, or restart it if it was already running." | *(none — the extension cannot start a process)* |

The last row is deliberately without a button: the extension has no way to start an agent, and a
button that lies is worse than a sentence that does not. It is also the only link-1 sentence the
popup ever shows, because the popup's other link-1 state is `unknown` — and `unknown` means the
link-2 sentence is the one with something to say.

### 6. More than one session

Several agent sessions are several bridges (ADR 0007), so the AI-app node **stacks**: `stacked-2`
and `stacked-3` draw one and two cards behind the front one, and the host writes the names it knows
beside it — "opencode, LM Studio ⟷ Beifahrer ⟷ Firefox". Beyond three the host writes "+ n more";
the artwork does not grow. Several browsers do the same on the right in the window's view, from
`BridgeStatus.browsers`.

### 7. The shared asset: `data/diagram/`

A sibling of `data/icons/` and `data/achievements/`, which is already the repo's place for artwork
two halves of the product both draw. The app compiles it into its GResource; the extension build
copies it into its bundle the way it already copies the achievement artwork.

Two properties make the sharing work:

- **No text in the file.** Every word is drawn by the host beside the artwork, out of its own
  catalogue (`app/locales/*.json`, `extension/_locales/*/messages.json`). That is the rule
  `data/achievements/*.svg` already follows, and it is what lets the same drawing serve a 680 px
  window and a 360 px phone: the labels reflow, the picture scales, and no second layout engine is
  needed inside the SVG.
- **State is a class list on the root**, never a second file:
  `l1-ok|l1-wait|l1-fail|l1-unknown`, `l2-…`, `here-window|here-extension`, `mark-ring`, `paused`,
  `stacked-2|stacked-3`, `dark`.

### 7a. Two arrangements, one source, one breakpoint at 420 px

Three nodes side by side need a real minimum width, and it is not the picture that sets it — it is
the words under it. A node name is around fourteen characters ("opencode · werkstatt" is twenty),
which is ~80 px at body size, and the two link captions need ~90 px of gutter each. Three names plus
two gutters is **~420 px of content width** before anything starts overlapping. Below that the
horizontal chain cannot be labelled honestly, only shrunk until it is unreadable.

So below 420 px the nodes stack **top to bottom**, the links run vertically, and every word moves to
the right of the artwork on the row of the thing it names — one narrow column of pictures and a
column of text, which is a list and reads like one. The breakpoint:

| host | mechanism | effect |
|---|---|---|
| app window | `Adw.Breakpoint` on `max-width: 420sp` in the window | desktop (680 px) horizontal; Phosh / GNOME mobile (360 px) vertical |
| popup | `@container (max-width: 420px)` on the popup body | desktop popup (360 px) and Firefox for Android (~360–412 px) both vertical |

A container query rather than a media query, because the popup's width is the popup's, not the
screen's; `Adw.Breakpoint` rather than a width signal, because that is what the window already uses
elsewhere and it is measured in `sp`, so it follows text scaling — which is right here, since the
minimum came from text in the first place.

**Two files, one generator.** `connection.svg` (600×132) and `connection-vertical.svg` (140×496).
One file cannot hold both: the arrangement lives in `viewBox`, which is an attribute and not a CSS
property, so no class can switch it — and the GTK side cannot rewrite it on a compiled-in GResource
without re-parsing the asset on every breakpoint change. Two files cost a few KB and switch for
free, on both sides, with the host swapping one resource path.

What keeps them from drifting is that they are **generated from one source**: one stylesheet, one
set of node drawings, one state set, placed twice. Palette, class names and states are written once,
so a state added to one arrangement cannot be missing from the other; only the coordinates differ.
The generator is a build-time script and not a runtime dependency — like the icon splice below, it
runs when the artwork changes, and what ships is the two files.

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
  `Adw.StatusPage` icon for the artwork, and an `Adw.Breakpoint` swaps the arrangement and the
  label layout at 420sp.
- **Extension** — `stateOf` (`extension/src/ui/status.ts`) keeps its `UiState` as the word; the
  diagram needs a second, smaller function over the same input, `linksOf(connection, client,
  paused)`, which never returns `fail` for link 1 (§ 3). The one behaviour change it would want is
  to stop collapsing "background has not answered yet" (`connection === undefined`) into
  `unpaired`, so link 1 can be `unknown` instead of red on the first paint. The arrangement is a
  container query on the popup body; no script decides it.

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

The last two are the accent pill of variant B, so they are read as words and not as decoration: in
German they are two characters longer than in English, which the pill absorbs and a fixed-width
badge would not.
| `diagram.link.ok` | Connected | Verbunden |
| `diagram.link.wait` | Connecting… | Verbindet… |
| `diagram.link.fail` | Not connected | Nicht verbunden |
| `diagram.link.unknown` | Not visible | Nicht sichtbar |
| `diagram.more` | + {count} more | + {count} weitere |
| `diagram.fix.nobridge` | Set Beifahrer up in your AI app, then start it. | Richte Beifahrer in deiner KI-App ein und starte sie. |
| `diagram.fix.nobridge.action` | Set up your app | App einrichten |
| `diagram.fix.nobrowser` | Open your browser and enter the pairing token. | Öffne deinen Browser und gib das Kopplungs-Token ein. |
| `diagram.fix.nobrowser.action` | Show the token | Token anzeigen |
| `diagram.fix.unreadable` | A session file could not be read, so this may be out of date. | Eine Sitzungsdatei war nicht lesbar, das Bild kann veraltet sein. |

Every heading in § 5 comes from the existing `status.*` / `state_*` pair; only the sentences are new,
and each one is an instruction with no restatement of its heading.

Extension (`extension/_locales/*/messages.json`) — `state_*` and `banner_*` stay; the banner text
moves under the diagram. New, same values for the five shared keys (`diagram_node_app`,
`diagram_node_beifahrer`, `diagram_node_browser`, `diagram_here_extension`, `diagram_link_*`), plus:

| key | en | de |
|---|---|---|
| `diagram_fix_unpaired` | Enter the pairing token from the Beifahrer window. | Gib das Kopplungs-Token aus dem Beifahrer-Fenster ein. |
| `diagram_fix_unauthorized` | Enter the current token from the Beifahrer window. | Gib das aktuelle Token aus dem Beifahrer-Fenster ein. |
| `diagram_fix_protocol` | Update the extension and Beifahrer to the same version. | Bringe Erweiterung und Beifahrer auf dieselbe Version. |
| `diagram_fix_waiting` | Start a session in your AI app, or restart it if it was already running. | Starte eine Sitzung in deiner KI-App, oder starte sie neu, wenn sie schon lief. |
| `diagram_fix_paused` | You stopped the agent. It cannot act here until you let it continue. | Du hast den Agenten gestoppt. Bis du ihn fortsetzen lässt, kann er hier nicht handeln. |

`action_pair` ("Pair…" / "Koppeln…") and `action_resume` already exist and are the buttons under the
first two rows and the paused one. `diagram_fix_waiting` has no button by design (§ 5).

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

### 13. Three defaults that were open questions

Round one left three placements undecided. They are decided here, as proposals — each is a default
that can be changed later without touching the artwork or the protocol:

1. **The diagram replaces the `Adw.StatusPage` icon, and nothing else.** The title and the sentence
   stay exactly where they are. The icon is the element that says the least per pixel; the title is
   the element a screen reader reaches first. Swapping one and keeping the other means the page
   gains a picture without losing its heading, and the Status page's structure does not change.
2. **The popup shows the diagram always, not only when something is wrong.** A picture that appears
   only on failure is a picture nobody has learned by the time they need it — and the `ready` case
   is the one where the person finds out, calmly, that there are two connections and which end they
   are looking at. The 140 px this cost in a horizontal layout was the real objection, and the
   vertical arrangement (§ 7a) removes it: at 360 px the diagram is a column beside its own labels,
   which the popup needed as a list anyway.
3. **Link 1 `wait` decays to `fail` after 10 s**, with a sentence that names the fix. A bridge that
   bound a port and was never initialised is not "still connecting" after ten seconds; it is an AI
   app that crashed, was killed, or never ran `initialize`. Amber forever would be the picture
   waiting politely for something that is not coming. Ten seconds is comfortably past
   `HEARTBEAT_MS` (5 s) and short of `STALE_MS` (15 s), so the decay never races the registry's own
   staleness. The sentence is § 5's link-1 row; in the window it keeps the **Set up your app**
   button, in the popup it stays buttonless.

## Consequences

- The Status page stops saying "something is wrong" and starts saying **which half** is wrong and
  **where the fix lives** — and the popup says the same thing in the same picture, so a person who
  learns it in one half already knows it in the other.
- The window's blind spots (a connecting browser, a refused token, a pause) become *visible* blind
  spots, drawn as `unknown`, instead of being silently rendered as something else.
- Two more files the extension build has to copy, one splice step in the app build, and one
  breakpoint in each host; in exchange, the bus in the diagram cannot drift from the bus on the
  launcher, and the Status page survives a 360 px phone instead of being clipped by it.
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

1. **Variant A or B** (§ 2). B is proposed and the mocks show both; the artwork supports either
   from the same file.
2. The three defaults in § 13, if any of them reads wrong against how the pages are actually used.
