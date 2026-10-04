# 0013 — "All sites" without asking, if the person says so

- **Status:** accepted
- **Date:** 2026-10-04
- **Supersedes:** one sentence of [ADR 0010](0010-temporary-access-and-asking-on-demand.md), "Every
  write a grant allows is confirmed. `confirmWrites: false` exists only on an explicit rule". The
  rest of ADR 0010 stands.
- **Asked for by:** the person, 2026-10-04: with "All sites" running at *Edit*, the extension still
  asked before every change, and there was no way to switch that off for the session.

## Context

A temporary "all sites" grant widens where the agent may go. ADR 0010 also made it ask before
every write, because a grant is easy to forget and a silent grant is how an agent changes things
unnoticed. An explicit rule per site could be made quiet, so the person who wanted no questions had
to add a rule for every site, which is the opposite of "all sites".

## Decision

The popup's *All sites* row gets the same *Ask before changes* switch a site rule has. Off, the
writes that grant allows skip the confirmation window.

- It lives on the grant (`Grant.confirmWrites`, in `storage.session`), so it ends with the grant
  and never reaches the stored policy.
- Only the `*` scope honours it, and only the grant live for the session asking. A grant of one
  origin is the answer to an on-demand prompt; an answer to "may this agent write here" is not an
  answer to "may it write here silently". Another session's quiet grant quiets nobody else.
- The switch shows only while a write grant runs. Default is asking.
- `page.evaluate` still always asks (`ALWAYS_CONFIRM`), and "confirm before closing tabs" is a
  separate setting this switch does not touch.
- Fail closed: any value other than a literal `false` is ignored, so an unreadable value asks.

## Consequences

A person who switches asking off for "all sites" has chosen to let a connected agent change pages
in their signed-in sessions without a window per change. The switch is off-by-default, per grant,
and gone when the grant ends.
