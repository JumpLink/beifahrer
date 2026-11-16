# 0029: History: an opt-in log of what the agent did

- **Status:** accepted (the UI and the storage wiring are not built yet; see "Steps")
- **Date:** 2026-11-16
- **Refs:** [#81](https://github.com/JumpLink/beifahrer/issues/81)
- **Relates to:** [0005](0005-the-person-sees-and-stops-the-agent.md) (the person sees the agent), [0007](0007-one-connection-per-agent-session.md) (session labels), [0015](0015-session-registry.md) (what a local record may hold), [0016](0016-scripts-without-asking.md) (the activity log is how a person sees quiet scripts afterwards)

## Context

The popup's activity log shows the last 20 requests, in memory and `storage.session`, and is gone when
the browser restarts. After a night of an agent working, or after a quiet script (ADR 0016), the person
cannot answer "what did it do on that site yesterday?". Issue #81 asks for a longer record, off by
default. The risk is the usual one: a history of an agent in a signed-in browser is a browsing history.

Priorities for the decision, in this order: usable (one switch, readable, clearable), private (the
record holds less than the activity log does), sensible (no new moving parts).

## Decision

**1. What is stored.** Exactly five things per call: time, method (wire name), site host, outcome
(`ok` | `refused` | `failed`) and, for a refusal or failure, the error code. Never a path, query, title,
page text, form value, fill text, script, argument, result, token, or session label. This is narrower
than the activity log, which keeps a capped preview of a fill or script and the session label: the
history has neither, because it lives on disk. `historyEntry` (core) builds an entry from those
inputs only and `parseHistory` cuts every other key when reading, so a later writer cannot widen it by
accident. An error code that is not a short `snake_case` word is stored as `failed`.

**2. Where it lives.** `storage.local` of the browser profile, key `history`, in the extension, written
by the extension. Not in the bridge: the bridge is the process the agent talks to, and a record kept
there is one the agent's side controls. (This differs from the issue's "bridge is the only writer".
ADR 0015's registry is a bridge-side file because only the bridge knows its sessions; the history
records what the extension decided, and the extension already enforces everything else.) Local only,
no export endpoint, no sync: the privacy rule "nothing leaves the device" is unchanged. `storage.sync`
is never used.

**3. Opt-in, default off.** One switch in the options page, off until the person turns it on. While
off, nothing is written and the key does not exist. Turning it off keeps what is there until the person
clears it; this is shown beside the switch ("Off. N entries are still stored. Clear"). A malformed or
missing setting reads as off (fail closed, like `parsePolicy`). The switch is not a feature in the
agent-facing feature table and no method can set it: only the options page writes it (as with pause,
only the person).

**4. Bound and clear.** At most 500 entries and at most 30 days, whichever bites first, newest first
(`pruneHistory`, run on every write and on read). One click, "Clear history", in the same place; it
removes the key. A browser reset or uninstall removes it too. No per-entry delete: it would invite
treating the log as curated.

**5. How the person sees it.** In the extension's options page, a section "History" under the switch:
a list, newest first, each row "time, host, what it did (the existing `method_<name>` words), outcome
and reason", grouped by day. At phone width (360 px) a row wraps into two lines: host and time on the
first, words and outcome on the second; no horizontal scroll, no table. Outcome is text as well as
colour (never colour alone). Every string goes through i18n in `en` and `de`; the "N entries" and the
empty state are plural-aware. The native window may read the same list later through the extension's
own storage only if a browser exposes it; it never goes through the bridge, so there is no
`beifahrer history` command. This is a deliberate cut from the issue: a command would make the bridge a
reader of data it must not hold.

**6. Per-site policy.** The history records calls whatever the level of the site, but a site on `none`
is recorded by host only, which is all the activity log shows for it too, so nothing new is revealed.
It never changes a decision: the check order (paused, feature, level, grant, confirm) is untouched and
nothing reads the history to allow or refuse. A paused call is recorded as `refused`/`paused`, because
"it tried while you had it paused" is what the person wants to know. Hosts only: the host column of an
internal page (`about:`, `moz-extension:`) is `null`.

**7. ADR 0016.** Quiet scripts are the main reason to want a history. The history does not store the
script text (point 1), so it answers "a script ran on host X at T, ok", not "what it ran". The popup
activity log keeps its preview for the current browser session, which is the only place the script
text is shown after the confirm window. A person who wants the text afterwards must not switch confirmation
off; the history is not a substitute for that, and the options page says so.

## Threat model

- **An agent reads the history.** No agent method returns it, and no tool is added for it. The bridge
  never receives it.
- **A page reads it.** It is extension storage, unreachable from a page or a content script that does not
  ask the background; no message type returns it to a frame.
- **Someone with the profile on disk.** They already have the browser's own history. The record adds
  hosts and times of agent calls, no content, and the person can clear it.
- **The log grows or gets poisoned.** Bounded by count and age; entries are rebuilt from five typed
  fields, so an agent-controlled string (a URL, an error message) cannot inject content except through
  the host (parsed by `URL`) and the short code pattern.
- **A reset is silent.** Clearing is explicit and shown. A storage write failure never fails the call
  being logged (as in the activity log): a lost line is better than a failed call.

## Privacy consequence

The statement at `docs/store/privacy.md` (and `privacy.de.md`), the source of
`/beifahrer/en/privacy/`, becomes wrong the day the history ships. Before the first release that
writes the history:

- § 5 table gets a row: "the history, when you switch it on: `storage.local` of this profile, host,
  time, method, outcome only, capped at 500 entries and 30 days, cleared by one click".
- The sentence "the activity log … never on disk" stays true for the activity log; the history is the
  one thing that persists, and the text says so next to the row.
- § 4 stays: nothing leaves the device. The Firefox manifest keeps `data_collection_permissions: none`
  because nothing is transmitted; re-check Mozilla's wording at that time.
- The store listings (`docs/store/listing.md`) gain a sentence only if the screenshot of the options page
  changes.

This PR does not change the privacy page: it describes shipped behaviour, and nothing is shipped yet.

## Steps

1. **Done in this PR:** `packages/core/src/history.ts`: entry type, `historyEntry` (redaction),
   `parseHistory`, `pruneHistory`/`pushHistory` (the cap), with unit tests.
2. Extension storage module and the switch (`history_enabled`, default off), written from `track`.
3. Options UI, i18n `en`/`de`, phone-width check, "Clear history".
4. Privacy page update (above) in the same release as step 2.

Steps 2 to 4 ship together; step 2 must not ship without the switch, the clear action and the privacy
text.

## Consequences

A person who turns the history on gets a month of "which site, when, what kind of action, did it work",
and a way to remove it with one click. A person who never turns it on has nothing stored and nothing
changed. The cost: a second record next to the activity log with a narrower schema, and no history of
script text, on purpose.
