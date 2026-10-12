# 0019: Capture a download the page starts out of sight

- **Status:** accepted (decided by the person on 2026-10-12, after the probe below)
- **Date:** 2026-10-12
- **Refines:** [0018](0018-download-from-a-sister-origin.md) (`page.capture`)
- **Asked for by:** a live test of `atruvia/download-document` on a bank postbox, 2026-10-12.

## Context

`page.capture` presses a button and takes what the PAGE hands over. It sees two things: an anchor
the page clicks (the page agent listens for `click` on `document`, capture phase), and a tab the
click opens (`tabs.onCreated` / `onUpdated`).

On the bank postbox neither fires. The click makes the page GET
`…/datasharing/ticket/download/<id>` with its own session (200), and then the page saves the file
itself. Firefox wrote the PDF to the Downloads folder and opened the copy in a new tab at a
`file:` address, which `judgeCapture` rightly refuses. The anchor listener missed it for a reason
that is structural, not a bug in the listener:

- A save made like FileSaver does it creates `<a download href="blob:…">` **off-DOM** and calls
  `click()` or `dispatchEvent` on it. An event on a node that is not in the document never
  propagates to `document`, so no capture-phase listener there can see it. On Meine AOK the anchor
  was attached to the DOM, which is why `via: "link"` worked.
- The page agent runs in the extension's isolated world. Anything it patches
  (`HTMLAnchorElement.prototype.click`) is patched on its own wrapper, not on the page's object.

Until this is decided, the error says what happened: the browser saved the file itself, the click
already ran, and a local file is not read (`refusedOpenMessage`, core/download.ts). Nothing else
changes with this record.

## Options

1. **Report only (done).** No new reach. The recipe still cannot return the file on this portal.
2. **Optional `downloads` permission, `downloads.onCreated`.** While a capture is armed, a download
   whose `url` is a `blob:` of the tab's own origin (or whatever `judgeCapture` allows) is
   cancelled and erased, and the same bytes are read through the existing `page.download` path,
   fetched by the page in its own session. The browser saves nothing. Costs: a new API permission
   the person grants once in the options page, like `webRequest` for `page.network`, plus its own
   feature switch and a sentence in the permission warning. `DownloadItem` carries no tab id in
   Firefox or Chromium, so correlation is by time window and by the blob's origin, and a download
   the person starts in another tab of the same origin during those seconds could be taken.
   A page that revokes the blob right after `click()` leaves nothing to read; whether
   `onCreated` is early enough is a measurement, not an assumption.
3. **`wrappedJSObject` / `exportFunction` in Firefox to observe anchor clicks.** Firefox only, and
   it runs code in the page's world. ADR 0012 refuses exactly that: the only route into the page's
   world is the one the page's CSP is there to block. Refused.
4. **`webRequest` on the ticket request.** It shows the URL, not the body, and fetching the ticket
   again spends a one-time ticket the page already used. Refused.
5. **Read the `file:` copy.** A local path is outside every origin and outside every per-site level.
   Refused.

## Probe result

`probes/downloads/run.mjs` (throw-away extension, synthetic page, Chromium and Firefox, 2026-10-12):

- `downloads.onCreated` delivers the `blob:` URL in both browsers, also when the page revokes the
  blob on the next line or in a timeout of 0.
- The page-side fetch reads a blob the page keeps (4015 bytes, both). A revoked blob is unreadable in
  both ("Failed to fetch" / "NetworkError"): `onCreated` is early enough to SEE the save, not to
  read a blob the page already revoked.
- Cancelling is mostly too late for a small blob: Firefox answers "already complete", Chromium
  completes about as often as it cancels. `removeFile` + `erase` leave no file in the download
  folder in every case.
- `DownloadItem` carries no tab id.

## Decision

Option 2, behind its own feature switch, as probed. Two changes from the proposal, forced by the
probe: the bytes are read FIRST, and only a successful read removes the browser's copy (cancel,
wait until the download settles, `removeFile`, `erase`); a revoked blob leaves the browser's copy
alone and the agent gets `failed`. Only a `blob:` of the tab's own origin is taken (`judgeSave`);
every other download stays the browser's own. The listener exists only while a capture is armed.

It adds an API permission, so the person decided it: ADR 0018's "No new browser permission" is
superseded on this point. It does not touch the hard rules: no main-world script (0012), no token
(0018), the gate stays in the extension and runs before the click, and nothing leaves the device.

## Consequences

- A feature `captureSaves` ("Take hidden downloads", off by default), the optional `downloads`
  permission requested in the options click and taken back when it is switched off, locale keys in
  every `_locales/*`. It has no method of its own: it widens `page.capture`.
- `page.capture` answers `via: "save"` for such a file.
- While a capture is armed, a blob download of the same origin from another tab could be taken
  (no tab id to correlate); the window is the capture's own timeout.
- An e2e on the synthetic off-DOM anchor, both browsers, with the revoke case.

## Not decided here

Whether a save of a `https:` sister address (no blob) should be taken the same way. The ticket case
shows a blob, so only that is in scope.
