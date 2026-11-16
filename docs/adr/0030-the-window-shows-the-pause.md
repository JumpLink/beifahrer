# 0030: The window shows the pause

- **Status:** accepted (nothing is built yet; see "Steps")
- **Date:** 2026-11-16
- **Refs:** [#83](https://github.com/JumpLink/beifahrer/issues/83)
- **Relates to:** [0005](0005-the-person-sees-and-stops-the-agent.md) (only the person resumes), [0010](0010-temporary-access-and-asking-on-demand.md) ("all sites"), [0014](0014-not-connected-speaks-first.md) (`alarmOf`), [0015](0015-session-registry.md) §5 (the registry cannot say "paused"), [0017](0017-native-desktop-app.md) §2 and §4 (the window is a view)

## Context

The window's Status page walks the registry ladder (`no-bridge`, `no-browser`, `ready`). A browser that
is paused still counts as `ready`, so the page says "Ready" while every call is refused. That is the
state ADR 0014 calls the worst kind: a quiet screen for a useless setup. Today the window only points
at the toolbar button.

The pause lives in the extension (`paused` in storage). ADR 0015 §5 left it out because the bridge is
never told. The question is whether the extension should tell it.

Priorities, in the owner's order: usable, then private and safe, then sensible.

## Decision

**Yes, narrowly: two booleans, pushed by the extension, shown by the window, never offered to agents.**

**1. The field.** A new extension → bridge frame, `{ type: 'state', paused: boolean, allSites: boolean }`.
Nothing else: no host, no level, no grant duration, no feature list, no time. `allSites` is "a
wildcard grant is live" (the blue dot of ADR 0014 rung 3). It rides along because the window needs
the same two words the toolbar has, and a second protocol change later would cost more than one
boolean now.

**2. Who sends it, when.** The extension, in the background, right after it has been welcomed (not in
`hello`: the hello is sent before the bridge has agreed to talk, and the pause changes after it) and on
every change of either value (`storage.onChanged` for `paused`, the grants listener for `allSites`).
It is re-sent after a reconnect, because the bridge keeps nothing across connections. A worker that
slept reads both values again when it wakes and connects, so the first state after a wake is true.
The frame is a statement of fact by the extension about itself; the bridge cannot request it and has
no reply to give.

**3. What the bridge does with it.** It keeps the latest pair on the live connection and writes it
into the registry entry of that browser as optional `paused` and `allSites`. A value that is not a
boolean is dropped (field absent), like every other fail-closed parse in this project. The registry
`v` stays 1: the fields are additive, an old reader's `parseRegistryEntry` copies only the fields it
knows, a new reader treats absence as unknown.

**4. Agents do not get it.** The state stays out of `toConnectedBrowser`, `browsers_list`, `welcome`,
`session` and every error text, and no MCP tool reads the registry. A unit test pins the shape of
`ConnectedBrowser` the way the window's status view is already pinned. What is new for an agent is
therefore nothing it can ask for: it still learns of a pause from the `paused` refusal on a call.
Honest limit: an agent with a shell can read the registry file, as it can read the config directory.
It learns nothing there that its next call would not tell it, and the file adds no way to lift a pause.

**5. Fail closed means "unknown", never "running".** The window's ladder gains two rungs and one
qualifier, loudest first:

1. **no bridge**, 2. **no browser** (unchanged);
3. **paused**: at least one connected browser reports `paused: true`. A yellow state with a sentence
   ("Paused in Firefox. Resume it in the browser."), no button that resumes (ADR 0005, ADR 0017 §2);
4. **ready**: every connected browser reports `paused: false`. `allSites: true` adds the blue badge
   of ADR 0014, with the words "All sites are open for now";
5. **ready, pause unknown**: at least one browser reports nothing (an old extension, an old bridge,
   a refused value). The page says "Ready" with the line "This browser does not report its pause.
   Look at the toolbar button", which is what the page says today. It never shows the green state
   for such a browser.

With several browsers the page shows the state per browser; the headline takes the worst known rung.
Colour never speaks alone (words and icon), as everywhere.

**6. Threat model.**

- *The report gives no power.* It is read-only data flowing away from the policy: no frame in either
  direction can set, clear or change `paused`, and `beifahrer-stop` and the popup stay the only
  writers (ADR 0005). Policy is still decided in the extension (AGENTS.md, first rule).
- *A forged or stale report* can only make the window wrong, not the policy. A hostile bridge could
  write `paused: false` into its own registry file, and the agent behind it could then see a green
  window; its calls would still be refused. The window labels the line as what the browser reported
  and keeps "Check connection" (ADR 0017 §7), which asks the real gate. Only the pairing token
  admits a connection, so a stranger cannot send the frame.
- *What widens:* the bridge process, the registry file (mode 0600, per-user directory) and any local
  reader learn two bits about the person's own browser, bit by bit when they change. That is the full
  cost; it is the same class as the browser name and version already in the entry.
- *Not widened:* no URL, host, tab, level, grant target, activity or history (ADR 0029) reaches the
  bridge. "All sites" says that a grant exists, not which agent session holds it.
- *Stale entry:* the registry is refreshed by the heartbeat; a browser that went away leaves with its
  connection. A report is never trusted past the connection that sent it.

**7. Migration.** `PROTOCOL_VERSION` stays 1; the frame is additive.

| Extension | Bridge | Result |
|---|---|---|
| new | new | the window shows the pause |
| old | new | no frame arrives; fields absent; rung 5, the status quo |
| new | old | the old bridge's `parseResponse` refuses an unknown frame and drops it; no error, no close; rung 5 |

There is no flag day and no version check. The extension sends the frame to any bridge; the
"new, old" row is a test, not a hope (step 3).

## Steps

1. `packages/core`: the `State` frame in `protocol.ts` (`ExtensionFrame`), `parseState` (booleans only),
   optional `paused` and `allSites` on `RegistryBrowser`, `presenceOf` gains the two rungs and the
   unknown qualifier. Unit tests, including "an old entry without the fields is unknown, not ready".
2. Bridge: keep the latest state on `Live`, write it into the entry, and keep it out of
   `toConnectedBrowser` with a test that pins `ConnectedBrowser`'s keys.
3. Extension: send `state` after the welcome and on `paused` and grants changes. Test against a bridge
   that ignores the frame (the old-bridge row).
4. Window: the rungs and per-browser lines in the Status page, `de` and `en` strings, update the test
   that pins the status view's fields (ADR 0017 §2) on purpose and keep it forbidding any control.
5. Docs: `docs/security/` data-handling page gains the two bits; AGENTS.md rule table needs no change.

Steps 1 and 2 may land first (the window shows "unknown" as before); step 4 only after 3.

## Consequences

A paused browser no longer looks like a ready one in the window, and the person sees "All sites" without
going to the toolbar. The cost is one frame type, two optional registry fields, and a status view that
now has to be tested for what it must not show. ADR 0015 §5 and ADR 0017 §2 stand for everything
except these two bits.
