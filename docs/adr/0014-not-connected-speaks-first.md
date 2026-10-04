# 0014: A missing connection speaks before a pause

- **Status:** accepted
- **Date:** 2026-10-04
- **Supersedes:** the toolbar sentence of [ADR 0010](0010-temporary-access-and-asking-on-demand.md)
  ("the toolbar sparkles carry a blue dot (`wide`, `wide-active`; only pause outranks it)"), the dot
  colours of [ADR 0005](0005-the-person-sees-and-stops-the-agent.md) §4 ("a red dot while paused, an
  amber dot when not paired or no bridge is running"), and ADR 0009 §2 plus the "No agent is not an
  error" half of §1. The rest of those three stands.
- **Asked for by:** the person, 2026-10-04: whether the extension is connected to the bridge has to
  be visible at a glance, "without a connection it is useless".

## Context

The button was a status light with four colours, and two of them were about states the person could
not act on from where they were looking. A red dot meant *paused*, and amber meant *no bridge
running* — but an agent session starts and stops by itself, so an amber button was the normal state
of a browser with beifahrer installed and no agent working. ADR 0009 had decided that on purpose:
"No agent is not an error: agents start and stop." The consequence was that the state which makes
the extension useless looked quieter than the state it is in by choice.

It was also invisible in the popup: "No agent" got no banner, and only the paused state, a refused
token and a version mismatch did. The word in the header was the whole message.

Two things were already true and made this a decision rather than a patch. The pause is the
person's own switch and outranks every connected look (ADR 0005), and a wildcard grant is live
whether or not an agent is connected (ADR 0010) — both put a rung between "quiet" and "loudest" that
a missing bridge now has to pass.

## Decision

One ladder, loudest first, in `alarmOf` (packages/core/src/toolbar.ts). The button, the badge, the
tooltip, the popup's word and the popup's banner all walk it, so they cannot disagree:

1. **not connected** — no bridge answered, or none is paired: a **red** dot, the badge `!`, and the
   state's own reason as the tooltip (`not paired yet`, `not connected`, `the bridge refused the
   pairing token`, `versions do not match`). This is the top rung: with no connection nothing else
   matters, including the pause, and it is the only one of the three the person has to fix before
   anything else they see is true.
2. **paused** — connected, and the person stopped everything: a **yellow** dot and the badge `II`.
   It is the person's own switch, so it stays louder than any connected look, and a warning rather
   than an alarm.
3. **"all sites" granted** — a **blue** dot (ADR 0010), over the idle or active look, only while a
   bridge is connected. A grant with nothing to spend it on is not the news the missing bridge is.
4. **agent active** / **connected, idle** — unchanged, and no banner.

Colour never carries a state alone: the header word is "Not connected", the banner names what to do
("Start a bridge, or check the pairing token in the settings", with *Settings* as the one action the
popup can offer), and the tooltip names the reason. The banner strip is Adwaita's own error or
warning colour mixed into its own surface, so both schemes follow `prefers-color-scheme` with the
rest of the page.

`unpaired` keeps its own first-run status page instead of a banner (ADR 0009): nothing below it can
do anything yet, and one clear step beats a strip. It is still "not connected" for the ladder, so
the button is red for it too.

The state switches live in both places: the button repaints on every status change
(`onStatusChange`), and the popup re-reads the status while it is open.

## Consequences

- A browser with beifahrer installed and no agent working now shows a red button. That is the point:
  an installed extension with no bridge cannot do anything, and the person is the only one who can
  change it.
- A paused extension whose bridge then stops shows "Not connected", not "Paused". Both are true; the
  one only the person can fix is shown, and the header's pause button still reads as paused.
- The dot colours live in one table (`LOOK_COLOUR`, core) that the icon build and the badge fallback
  both read, because a browser without `setIcon` must not paint a different state than the icon.
- The popup and the options page share one banner (`extension/src/ui/banner.ts`, over the table in
  `extension/src/ui/status.ts`); the page says what it can do about a state, the table says what the
  state is. That is the copy of the "which states speak" list that was in both of them.