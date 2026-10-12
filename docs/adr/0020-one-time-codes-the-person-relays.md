# 0020: One-time codes the person relays, and a run that needs the person

- **Status:** accepted (decided by the person on 2026-10-12)
- **Date:** 2026-10-12
- **Refines:** [0005](0005-the-person-sees-and-stops-the-agent.md) (switches), [0012](0012-running-the-agents-own-script-in-the-page.md) (a capability of its own)
- **Asked for by:** the person, 2026-10-12: an agent that logs back in to a portal stalls at the
  second factor, and the only way on is a message to the person and a code back.

## Context

A recipe such as `atruvia/login` ends at a page only the person can pass: a TAN, an approval on
their own device, a login without a saved PIN. Until now the run simply failed, and the agent had
no structured way to tell the person what was needed or to continue afterwards.

Two things are missing:

1. A run outcome that says "the person has to do something", with what and where.
2. A way to type a one-time code the person relayed, which the hard rule "never fill a password
   field" did not cover and `page_fill` cannot do safely (it takes any text, anywhere).

## Options

- **Leave it failing.** Safe, and the agent keeps asking the person to log in by hand every time.
- **`page_fill` into the code field.** Works today, but the guard is the agent's own judgement:
  nothing stops it from filling a PIN field with a value it was given.
- **A narrow method of its own, behind its own switch.** Chosen.

## Decision

1. **`needs_person`.** A recipe step `person` (data only: `kind`, `when` or `whenAny`, `prompt`,
   `codeParam`) ends the run when the page shows what it describes, and is skipped otherwise. The
   result carries `next` (the step to resume at) and `person: {kind, origin, prompt, acceptsCode,
   codeParam?}`. Resume goes through the existing `from`; the code is an ordinary param.
2. **`page.enterCode`.** Level `write`, feature `oneTimeCodes` (off by default), confirmed like any
   write. A recipe uses it through the step `enter-code`.

## Risks

- The second factor is relayed by the person: whoever reads the chat has the code.
- The code travels through a chat and an agent. End-to-end encryption of that chat (OMEMO) is not
  finished, so the transport may be readable by more parties than the person intends.
- A code expires within minutes, which limits what a leak is worth but does not remove it.
- An agent could try to type a code it was never given, or into the wrong field.

## Guards

- The switch `oneTimeCodes` is off by default, and the person turns it on knowingly.
- `page.enterCode` fills ONLY a text input marked as a one-time code (`autocomplete="one-time-code"`,
  numeric `inputmode`, or a code / TAN / OTP / Einmal label).
- It NEVER fills `input[type=password]`, and never a field labelled PIN or password.
- The value must be 4 to 10 letters or digits.
- Every write is confirmed in the browser window, which shows a mask, never the code.
- The code is redacted as `••••` in the activity log, the recipe log, error messages, the MCP
  result and the bridge. Recipe params marked `secret: true` are redacted in every echoed log; the
  param of an `enter-code` step is secret whether or not the file says so.
- Unchanged: Beifahrer never fills a password field and never reads or replays credentials, tokens
  or cookies. A code is typed once, at the person's word, and never read back.

## Consequences

- The hard rule in `AGENTS.md` still says never fill a password field. A one-time code is a
  different thing and is typed only through `page.enterCode`.
- Recipes can declare a second factor as data. What each portal's pages are called stays a
  property of the recipe and has to be verified against a live page.
- The kind `approval` and `device` need no code: the agent tells the person and resumes.
