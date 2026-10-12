# 0018: Download from a sister origin, triggered by the page

- **Status:** accepted
- **Date:** 2026-10-12
- **Asked for by:** the person, 2026-10-12: collect the documents from two portal postboxes
  (a bank portal and a health insurer) without handing the agent any token.

## Context

`page.download` fetches a URL the agent names, and only on the tab's own origin
(`resolveDownloadTarget`). That rule is right, and it fails on exactly the portals that matter:

- The "Download" button has no `href`. It asks an API for a one-time ticket and then clicks an
  anchor it makes, so there is nothing for the agent to name.
- The document lives on a **sister origin**: a portal at `meine.<site>` keeps its attachments at
  `app-api.meine.<site>` and opens the result in a viewer tab. A same-origin check refuses it.
- The obvious way around both is to read the portal's token out of `localStorage` and replay it.
  That puts a credential in the agent's hands. It is out of bounds and stays so.

## Decision

A new method, `page.capture`: click a button, let **the page** produce the document, take it.

- The page does the fetching with the browser's own cookies. The agent never sees a token, cookie
  or header, and none is read or replayed.
- What a click may produce is judged by `judgeCapture` (core/download.ts), and nothing else:
  a `blob:` the tab's own origin made, a URL on the tab's own origin, or a URL on a **sister
  origin** — `https`, default port, same registrable domain as the tab. Another site, `http`,
  another port, a bare IP, `data:`, `file:` and `javascript:` are refused.
- The registrable domain comes from a short built-in table of two-label suffixes, no public-suffix
  list. A wrong guess can only refuse a sister, never admit a stranger.
- The per-site level is checked for the **target origin** as well (`gate('page.download', target)`)
  before a byte is read from it. Permission for the tab does not cover its sister.
- The click is a write: it needs `write` on the tab, the confirmation window where one is set, and
  both the *Click* and *Download* switches (`ALSO_NEEDS`). A capture is a button press.
- A tab the click opened is closed after its document was taken, and left open when the origin was
  refused. Only the origin of a refused address is reported: the rest may hold a one-time ticket.
- `page.rows` reads the rows of a list, scrolling a virtual-scroll list, because a role-less row has
  no entry in the outline. It needs `read`. Recipes get three step kinds on top: `rows`,
  `click-row` and `capture`. Recipes still hold no gate (ADR 0006).

## Consequences

- No new browser permission: the extension already holds `tabs` and the optional host permissions.
  A sister origin the person has not allowed is refused by the same level check as any other call.
- The person must raise the level for the sister origin once (`read` is enough) before a capture
  that ends there works.
- Marking a document as read, where the portal does that on download, is a side effect of the
  click, not something beifahrer adds. Recipes that download say so.
- Not covered: a document behind a form, a TAN or a login. A capture never types, sends or deletes.
