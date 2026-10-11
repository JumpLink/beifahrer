# 0016 — Scripts without asking, if the person says so

- **Status:** accepted
- **Date:** 2026-10-11
- **Supersedes:** one condition of [ADR 0012](0012-running-the-agents-own-script-in-the-page.md),
  "every run is confirmed" (`ALWAYS_CONFIRM` silenced by nothing). Every other condition of ADR 0012
  stands. It also replaces the sentence "`page.evaluate` still always asks" in
  [ADR 0013](0013-all-sites-without-asking.md).
- **Asked for by:** the person, 2026-10-11: with *Ask before changes* off for a site, every script
  still opened a window, so an agent could not work on its own, and scripts are where the extension
  is most capable.

## Context

ADR 0012 let an agent run its own script under conditions, one of them being a window per run.
That keeps a person who never read the code from approving it by a standing rule. It also means
an agent that works through scripts stops at every step until the person clicks, which defeats
the reason a person hands work to an agent. *Ask before changes* (`confirmWrites`) could not be
reused: it describes what the level table describes, and a script reaches further than any write.

## Decision

A second switch, *Run scripts without asking*, separate from *Ask before changes*.

- Per site it is `OriginRule.confirmScripts`, stored with the rule. For "All sites" it is
  `Grant.confirmScripts`, in `storage.session`, ending with the grant and read live for the session
  asking, like `confirmWrites` (ADR 0013).
- `decide` reads exactly one field per method (`confirmFieldOf`): `confirmScripts` for a method in
  `ALWAYS_CONFIRM`, `confirmWrites` for every other write. Neither switch silences the other.
- Turning asking off is not written on the click. The switch snaps back and a warning says what the
  agent could then do unasked; only *Allow anyway* stores `false`. The warning for "All sites" names
  every site the agent opens. While it is off, a standing note says so.
- The switch shows only where a script could run: feature `script` on and level (or grant) `write`.
- A write only a prompt's answer allowed still asks, as before.
- Fail closed: only a literal `false` is quiet; anything else asks. Turning asking back on removes
  the stored `false` (`withRuleQuiet`, `withWildcardQuiet`).
- Unchanged from ADR 0012: off-by-default feature, `write` level, explicit `none` and pause block,
  `world: "main"` refused, the extension's globals shadowed, bounded JSON result, activity log and
  pill. The tab's origin is re-read before every run, with or without a window, so the decision
  belongs to the page the script actually runs in.

## Consequences

A person who switches this off has chosen to let a connected agent run code it wrote, in their
signed-in session on that site, or on every site for the length of an "All sites" grant, without
seeing it first. They see it afterwards in the activity log and the pill, and Stop still stops it.
The default is unchanged: nobody who does not flip the switch and confirm the warning gets less
protection than ADR 0012 gave.
