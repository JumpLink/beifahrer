# 0026: Installing the extension from the app, in the right browser

- **Status:** accepted — decided by the person, 2026-11-05. Implemented in `app/src/window/browser-model.ts` (pure) and `browser-host.ts` (GIO and file reads).
- **Date:** 2026-11-05
- **Asked for by:** the person, 2026-11-05: the setup assistant sent every browser to a link that the
  system opened in whatever handled it, so a Firefox user whose default was Chrome got the file in the
  wrong browser, and nothing said afterwards whether the extension was in or connected.
- **Relates to:** [0023](0023-onboarding-for-beginners.md) (the setup assistant this step belongs to),
  [0017](0017-native-desktop-app.md) (the window is a view: this ADR adds reads, no browser is written),
  [0025](0025-connection-diagram.md) (what "connected" means)

## Context

The extension step offered two kinds of link and a list of browsers. A `Gtk.LinkButton` is opened by
the desktop's default handler, so "Firefox" with Chrome as the default opened the signed file in
Chrome. The step also knew nothing about the result: a person could not tell "not installed" from
"installed but this session has no connection".

Measured on Chromium 149 and Firefox: an extension loaded unpacked is in `Preferences` under
`extensions.settings.<id>` with a `path` and no `manifest` (a store install carries its `manifest`);
Firefox lists add-ons in `<profile>/extensions.json`. Chromium has no per-user, non-store install
path that works on Windows and macOS: the policy and registry routes need administrator rights and
Chrome ignores policy-installed extensions outside a managed device there.

## Decision

### 1. The default browser is assumed

`Gio.AppInfo.get_default_for_uri_scheme('https')`, mapped to a browser by its application id or
executable (`browserOfApp`, pure, tested for Linux ids, Windows executables and macOS bundle ids). It
is preselected and listed first; every other browser stays choosable. An unknown default changes
nothing: the list keeps its order and Firefox is preselected, as before.

### 2. Firefox: open the signed file in Firefox

The button launches the matched Firefox `Gio.AppInfo` with the URL of `beifahrer.xpi`
(`launch_uris`). Firefox then asks to add it and keeps it current through `updates.json`. When no
application matches, the launch fails, or the window is sandboxed, the link goes to the default
handler instead: the person may have to drag it into Firefox, but never gets nothing.

### 3. Chromium family: unpacked until a store listing exists

Chrome, Chromium, Brave and Edge keep the manual steps (zip, Developer mode, Load unpacked). An
enterprise policy was rejected: it needs administrator rights and, on Windows and macOS, Chrome
refuses it off managed devices. When a listing exists, its URL goes into `STORE_URLS` and
`CHROMIUM_STORE_IDS` (both empty today, pinned empty by a test) and the button opens the store page
IN that browser, using the same launch as § 2. Until then no store page is offered.

### 4. Safari is out of scope

It is recognised so the default can be named, and its row says the extension lives in a Mac app. It
has no install action here; the Safari build is owned by its own branch.

### 5. Detection only reads

Firefox: `profiles.ini` names the profiles (`[Profile…]` and `[Install…]`), each has an
`extensions.json` with the id `beifahrer@jumplink.eu`. Chromium family: the user-data folder's
`Default` and `Profile N`, in `Preferences` and `Secure Preferences`, matched by the manifest name
`Beifahrer` (read from the extension's own `manifest.json` and `_locales` for unpacked ones) or a
known store id. Nothing is written and no file outside a browser's profile root is opened. Tests and
screenshots point `HOME` at fixture profiles.

### 6. Three states, and what a sandbox can say

Per browser: **connected** (a session has it), **installed, not connected** (in a profile, no
session), **not installed**. Connected wins over the files. In a Flatpak the profiles are not
visible, so the answer is only "connected" or "not connected", and the install button goes to the
default handler (a portal). The states are shown in the extension step and on the Browser page, as a
word under the browser's name: a colour is never the only carrier.

## Consequences

- A new Chromium-based browser is one entry in `BROWSERS` and one in `profileRoots`.
- The profile layouts are the browsers' own and can change; a layout that stops matching shows
  "not installed" for a browser that is connected, and "connected" still wins.
