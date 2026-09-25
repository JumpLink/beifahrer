# 0009: The pages say only what is not normal

- **Status:** accepted
- **Date:** 2026-09-25

## Context

After ADR 0008 the pages looked like Adwaita but read like a manual. The popup opened with
"Connected to 2 agent sessions (ports 47813–47822).", a switch whose subtitle repeated its
title, an explanation under the site level, a count of features, and a sentence for an empty
activity list. The options page had a paragraph under every group and protocol method names
(`page_read`, `tabs_move`, …) as row subtitles. Screenshots were two groups for one decision.
The person's verdict, looking at the German popup in Firefox: too much text, and it reads like
generated filler. The options page also sat at the right edge of the tab in Firefox.

## Decision

The pages follow the GNOME HIG's quiet defaults, with the elements `@gjsify/adwaita-web` has:

1. **The normal state has no text.** The popup and the options header show the toolbar's own
   sparkles and one word of state (Ready, Working, Paused, No agent, Not paired). The sparkles
   breathe while the agent works (off under `prefers-reduced-motion`). "No agent" is not an
   error: agents start and stop.
2. **Only what is not normal gets a banner, with the one action that fixes it.** Paused →
   Resume. Token refused, version mismatch → Pair… / Settings. Not paired at all is the first
   run, so the popup shows a compact status page with one button instead of its controls.
3. **Rows have short titles and subtitles only for a value** ("Since 14:27", "Last 20", the
   port range). Icons as row prefixes where they carry meaning: each feature, each activity
   entry (its feature's icon), each agent session.
4. **Explanations sit behind an info button** in the group header, opening a popover with one
   line. The site levels explain themselves in their hover text. Developer detail (the port
   range, the environment variables, which protocol methods each switch covers) lives in the
   options page's collapsed Advanced group, never in the popup.
5. **Feedback is a toast.** Connect, save, delete (with Undo, instead of asking first), a
   refused permission.
6. **The popup is at-a-glance:** state, this site's level (a toggle group with icons: None,
   Read, Edit), connected sessions (hidden when there are none, Disconnect as an icon button),
   the last five activities with "Show all" into the options page, and Settings. The feature
   switches moved to the options page.
7. **Screenshots are one switch.** Turning it on asks the browser for access to all sites in
   the same click; a refusal leaves it off with a toast. A warning row with "Grant" appears only
   when the two diverge (the grant was taken back in the browser's settings).
8. **The confirm window is a title, the site, what will change, and the answers:** Deny,
   Always allow, Allow. "Always allow" is the former "don't ask again" switch as a third answer.
   The in-page pill is one phrase and Stop.
9. **The copy rules are checked, not remembered.** `scripts/locales.ts` fails the build on a
   key no page or script reads any more, and on an em or en dash, an exclamation mark or a curly
   quote in any message. The e2e checks the same on each page's visible text and prints its word
   count.

## Consequences

- The popup's own English words (not counting hosts, session labels and activity entries) went
  from about 60 to about 14, counted on the e2e's screenshots in the same state.
- A capability the person rarely changes costs one more click (the options page). What they
  check often (state, this site, what the agent did) stays in the popup.
- The icons the package does not compile in are registered from `@gjsify/adwaita-icons`
  (`src/ui/icons.ts`, loaded by `ui.js` only). `ui.js` grew by about 12 KB.
- Gaps met in `@gjsify/adwaita-web` 0.52.0 are listed in AGENTS.md: `<adw-switch-row>` has no
  prefix slot, `<adw-toggle>` no tooltip, `<gtk-popover>` no non-menu role, and the compact
  status page is too large for an empty list in a popup.
