# 0022: The login QR code, decoded for the person to scan

- **Status:** accepted (decided by the person on 2026-10-13)
- **Date:** 2026-10-13
- **Refines:** [0020](0020-one-time-codes-the-person-relays.md) (`needs_person`), [0005](0005-the-person-sees-and-stops-the-agent.md) (switches)
- **Asked for by:** the person, 2026-10-13: `aok/login` ends at a page that shows a QR code and
  asks to scan it with the insurer's app. The person is not at the browser, and the code is
  shown in a tab they cannot see.

## Context

`needs_person` tells the person what to do, but the message cannot carry the thing to scan. The
QR code lives in the page as an image, and the person reads their messenger, not the tab.
Sending a screenshot would work only for the active tab and screenshots are off by default.

The content of such a code is a **session challenge**: whoever scans it with the app approves a login
for the browser session that displayed it. That is why this is a decision and not a convenience.

## Options

- **Leave it.** The person has to be at the browser. Safe, and the point of the recipe is lost.
- **A screenshot of the tab.** Needs the screenshot switch and the active tab; sends far more than the code.
- **Decode in the page agent.** Puts a decoder into the script injected into every tab.
- **Rasterize in the page agent, decode in the background.** Chosen.

## Decision

1. **`page.readQr`.** Level `read`, feature `qrCodes` (off by default). The page agent draws each
   `<img>`, `<canvas>` and `<svg>` of QR-code size (at least 80 px a side, optionally narrowed by `name`
   against alt, label, title, id and class) to a canvas and hands over RGBA pixels; the background
   decodes them. Pixels come from the page's elements, so the tab need not be the active one. A
   cross-origin image taints the canvas and is skipped; the failure says how many, never what.
2. **Decoder.** [jsQR](https://github.com/cozmo/jsQR) 1.4.0, pure JavaScript, Apache-2.0, which is
   compatible with this project's licences. It lives in the background bundle only.
3. **No tool.** Only the recipe runner calls `page.readQr`. The agent has no `page_read_qr`.
4. **Recipe syntax.** The `person` step takes `qr: {name?: string[]}`. The result is
   `person: {…, link?}`; `lotse` puts `link` into its message to the person.
5. **Without the switch** the step still ends the run with `needs_person`; `link` is absent and the
   person scans the code in the tab, as before.

## Risks

- The link is a session challenge. It passes through the agent, the messenger and its transport.
  Whoever sees it in that time can scan it. The challenge expires, and approving a login usually also
  needs a code that only the person's own app shows, which is entered in the browser.
- Anything on the page of QR-code size is decoded, so a hostile page could show a QR code
  of its own. The agent passes it on unchanged; the person decides what they scan. The prompt names the site.

## Guards

- The switch `qrCodes` is off by default; the person turns it on knowingly (popup and options, en + de).
- `page.readQr` is `read`: the site's level and the pause apply like for any read. It has no write
  effect and fills nothing.
- The decoded text goes ONLY to `person.link`, to be shown to the person. It is not in the step log,
  the message, the activity log (which never holds page text), an error, or any file.
- `lotse` keeps it out of its question store and log and refuses it on a free hosted model, as it does a code.
- Unchanged: Beifahrer never reads or replays credentials, tokens or cookies. A QR code is shown
  to the person; nothing is signed in on their behalf.

## Consequences

- `aok/login` 1.1.0 uses `qr: {}` on its TAN step. What the page calls its QR image is a property of
  the page and is verified live.
- A recipe whose QR code sits in a cross-origin image cannot offer the link and falls back to the tab.
