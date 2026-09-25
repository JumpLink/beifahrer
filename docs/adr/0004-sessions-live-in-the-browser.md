# 0004 — Saved sessions live in the browser, behind a browser-level switch

- **Status:** accepted
- **Date:** 2026-09-25

## Context

The person works in several Firefox windows. Closing the window that holds the sorted and pinned
tabs, while another window is still open, loses them: the browser restores only the last window
on the next start. They asked for an agent that can sort, pin, close, save and reopen tabs, and
lay them out for whatever task is at hand.

Three questions follow: who may do this, where a saved session is stored, and what a restore is
allowed to open.

## Decision

### 1. A browser-level switch, separate from the per-site levels

Moving, pinning, closing and grouping tabs touch no page content, so the per-site level cannot be
their gate. They sit behind one switch in the extension: **"Let the agent manage tabs and
windows"**, off by default, in the popup and the options page. `REQUIRED_GRANT` in
`packages/core/src/policy.ts` lists the grant for every method next to `REQUIRED_LEVEL`, and
`runMethod` checks it before any handler runs, so no handler can forget it. Without the switch,
every tab-management method answers `forbidden` and tells the agent to ask the person.

The per-site rules still apply where a method touches a site: a new URL the agent supplies
(`windows.create`, `sessions.define`) needs `read` on its site, the same rule as `tabs.open`.
Whatever comes back about a tab is redacted as in `tabs.list`. Closing tabs opens the
confirmation window with the list of tabs (host only for a tab below `read`), unless the person
ticked "don't ask again".

### 2. Sessions are stored in the extension's `storage.local`, never on the bridge

A session holds the person's browsing: every URL of every tab, including the ones on sites the
agent may not see. The bridge is the side the agent talks to and may be a different process for
each agent session. Storing sessions there would put below-`read` URLs where the agent's side
can read them, and would lose them whenever the bridge changes. In the browser profile they sit
next to the policy, stay on the device, and work without any agent: the options page saves,
restores and deletes them, and lists the browser's recently-closed windows with a Restore button.

Private windows and non-normal windows (popups, the confirmation window) are never saved. Only
http(s) tabs are saved, because an extension cannot reopen `about:` or `file:` pages.

### 3. Restoring the person's own tabs opens all of them; an agent's workspace is checked again

A session the person saved (or the agent saved from the person's windows) comes back whole,
below-`read` tabs included. They were the person's own tabs, and the agent never learns their
URLs, so reopening them carries nothing anywhere. A session the agent defined from its own URLs
(`kind: agent`) is checked again at restore time against the policy as it is then: if the person
has lowered a site since, its tab is skipped.

Restored tabs load lazily where the browser allows it. Firefox creates discarded tabs, except
pinned ones, which it refuses to create discarded. Chromium has no lazy creation, so it opens
the tab and discards it once the page has loaded. It waits for the load so that it never discards
a tab that has no committed URL yet.

### 4. Automatic snapshots, and the browser's own list

Snapshots are taken 10 s after the last tab or window change and every 5 minutes, and the last 20
are kept as `autosave-<time>`. A snapshot identical to the newest one is skipped, so an idle
browser does not rotate out the snapshot that still contains the closed window. The person can
switch snapshots off in the options page. The browser's own recently-closed list
(`sessions.getRecentlyClosed` / `sessions.restore`) is available to the agent as tools and to the
person as a list in the options page. A tab-management close of a whole window goes through
`windows.remove`, so the browser records it as one closed window that can be restored in one
step.

## Consequences

- New permissions: `sessions` and `tabGroups`. Neither sends anything anywhere, so the Firefox
  manifest's `data_collection_permissions: none` stays true.
- Sessions are per browser profile. Moving them between browsers or machines would need an export
  that the person triggers, and none exists yet.
- `storage.local` quota: 20 snapshots of about 100 tabs each is well under a megabyte.
- Tab groups need a browser that has them (Chromium, Firefox 139 and later). Elsewhere the group
  tools answer `unsupported`, and a restore reopens the tabs without their groups.
