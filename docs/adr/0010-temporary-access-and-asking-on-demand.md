# 0010: Temporary access to all sites, and asking on demand

- **Status:** accepted
- **Date:** 2026-09-25
- **Asked for by:** the person, 2026-09-25: access to all sites would be nice, "maybe limited in
  time or to the session so it doesn't stay on permanently by accident. Or the extension asks when
  a request needs access to another site, so it can simply be confirmed."

## Context

Every site starts at `none`, and the person raises it in the popup on that site's tab. That is
the right default, and it makes a task that crosses many sites (research, comparing offers) a
string of refusals: the agent gets `forbidden`, tells the person, the person opens the tab, raises
the level, and the agent tries again. A permanent "all sites" switch would end that, and would
also stay on long after the task, which is the accident the person named.

## Decision

Both, and both fail closed.

### A. All sites, for a while

- The popup's *All sites* row grants `read` or `write` on every http(s) site **the person has no
  rule for**, for **1 hour** (default), **until the browser closes**, or for **one agent session**
  (it ends when that session's connection closes). There is no "forever".
- It is a `Grant` (`packages/core/src/policy.ts`): `{ scope: '*' | origin, level, until?,
  sessionId? }`. Grants live in `storage.session` (memory where a browser lacks it), never in the
  stored policy, so none survives a restart. `decide(policy, method, url, { now, session })`
  checks the end time itself; the alarm and timer in `extension/src/grants.ts` only clean up.
  `parseGrants` drops each malformed grant on its own, and one that claims to run longer than a
  day.
- **Explicit rules win.** A site at Read stays at Read under an "all sites: edit" grant. A site the
  person set to *None* is now stored as an explicit block (`withRule(…, { level: 'none' })`; the
  options page's *Remove* forgets a site instead), and no grant reaches it.
- **Every write a grant allows is confirmed.** `confirmWrites: false` exists only on an explicit
  rule; a grant widens where the agent may go, never how quietly it changes things there.
- **The browser's access follows the grant.** The popup requests `http://*/*` + `https://*/*` in
  the click (the first `await`, for Firefox). Not `<all_urls>`: screenshots hold that one, and
  ending the grant must never take it. When the grant ends, `hostsToRelease` (core) decides what goes back
  and `permissions.remove` returns it. What was requested for a grant is remembered in
  `storage.local`, because the browser keeps an optional permission across a restart that
  session storage does not survive; the next start gives it back.
- **The person sees it.** While a wildcard grant is live the toolbar sparkles carry a blue dot
  (`wide`, `wide-active`; only pause outranks it), and the popup shows the level, the time left and
  *End*.

### B. Asking on demand

- When a call is below the site's level, or the browser's grant for a site with a level is
  missing, `gate` (handlers.ts) opens the confirm window: "*session* wants to read *site*", with
  **Allow once**, **For this session**, **Always** (writes the ordinary persistent rule) and
  **Deny**. Each yes requests the site's host permission in its own click.
- No prompt when paused, for a switched-off feature (preflight refuses before any handler), for a
  non-web page, for a site the person blocked, or when the person switched *Ask for other sites*
  off in the options (default on).
- One prompt per site and session at a time: concurrent calls wait on the same window, and an
  answer covers every call waiting on it that needs no more than it granted. No answer within the
  confirm timeout (two minutes), a closed window and Deny are `forbidden`. After a Deny the same
  session is not asked for that site again until it reconnects.
- *Allow once* stores nothing; the host access it needed is given back after the call. *For this
  session* is a `Grant` for that origin and session. Writes allowed either way are confirmed.

### Session identity

A session-bound grant names the **extension's own** random id for the connection
(`bridge-client.ts`), not the bridge's `connectionId`: the bridge is the agent's side, and a
bridge that claimed another session's id would borrow its grants.

## Consequences

- The agent's `forbidden` for a site below its level now usually arrives as a question to the
  person instead, after up to two minutes when nobody answers. Wire error messages stay English
  and name what the person can do.
- The bridge gives every call that touches a site the prompt's two minutes (`ASK_TIMEOUT_MS`,
  core) on top of its own timeout (`timeoutFor`), so the agent does not give up while the person
  is still reading the question. A page that hangs is therefore given up on later, too.
- `tabs_list` shows titles for sites a grant opened, since the agent may read them anyway. Tab
  management and saved sessions still look at the stored policy only (fail closed: a grant does
  not let `window_create` or `sessions_define` open a URL).
- Setting a site to *None* now leaves a row in the options' site list (Blocked). *Remove* is the
  old "back to the default".
- **Measured** (Chrome for Testing 154.0.8037.0, Playwright's Chromium build, 2026-09-25, with a
  throwaway probe extension — `permissions.request` never resolves headless with nobody to click
  the browser's own bubble, so the granted state had to be seeded into the profile's stored
  extension permissions directly): yes, `permissions.remove` of `http://*/*` + `https://*/*` also
  removes any narrower host permission those two patterns cover, and it does so whether or not the
  wildcard itself was ever actually granted — Chromium subtracts by URL-pattern coverage, not by
  matching the removed patterns' own identity. A site's own permission, requested long before any
  "all sites" grant existed, goes with it all the same. Firefox removes exactly the listed
  patterns. `hostsToRelease` (policy.ts) now holds the wildcard back from `permissions.remove`
  while the stored policy or a live grant still needs any site, so ending "all sites" no longer
  takes a site's own browser permission down with it; the trade is that the raw browser permission
  for "all sites" can then outlive the popup's own timer a little, until the last site that needs
  it stops needing it — `decide` (the actual gate) already stops honouring the ended grant the
  moment it ends, regardless of what the browser still holds. If a site's browser grant is ever
  lost anyway (the wildcard released while nothing was thought to need it, the person having since
  revoked it by hand in the browser's own settings, …), the missing-grant case of B still recovers
  it with one prompt.
- The e2e cannot click the browser's permission prompt or the confirm window; it seeds grants and
  answers prompts through E2E-only hooks, like Disconnect.
