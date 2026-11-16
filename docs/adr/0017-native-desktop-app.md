# 0017: A native desktop window that only looks

- **Status:** accepted. § 2 and § 3 are partly superseded by [ADR 0023](0023-onboarding-for-beginners.md)
  (the window may write an agent's config on request) and § 6 is superseded by it (one package).
  The window's lifetime is refined by [ADR 0024](0024-the-window-stays-in-the-background.md)
  (it may stay in the background with a status icon).
- **Date:** 2026-10-04
- **Relates to:** [ADR 0015](0015-session-registry.md) (what it reads),
  [ADR 0005](0005-the-person-sees-and-stops-the-agent.md) (only the person pauses and resumes),
  [ADR 0014](0014-not-connected-speaks-first.md) (a missing connection is not quiet),
  [ADR 0008](0008-ui-on-adwaita-web.md) (the browser UI is Adwaita too)
- **Asked for by:** the person, 2026-10-04: a native Adwaita app for Beifahrer, not a web UI.

## Context

The extension shows the person what the agent does, but only inside the browser. Nothing on the
desktop says whether Beifahrer is running, which agent sessions exist or whether a browser is
connected. With ADR 0015 there is a contract to read. The question is what the window may do with it.

## Decision

**1. It is a native libadwaita application** (`desktop/`, `@gjsify/adwaita-app`), not a page served by
the bridge. The headless `beifahrer mcp` is unchanged and needs no window. A web UI would have meant
an HTTP surface on a process that today only listens on loopback for an extension's origin, with the
DNS-rebinding and origin questions that come with one.

**2. It is a view and a place for bridge-side settings, never a policy instance.** The window cannot
pause or resume, switch a feature, or change a site's level, now or later (ADR 0005: only the person
resumes, and the person does that in the browser). It also cannot see them: the registry does not
carry them (ADR 0015 §5). A test pins the status view's fields so that a pause or level field cannot
be added by accident. Settings that may come are only the bridge's own: port range, the `--allow-write`
default, the session label, the recipe directory, rotating the token, the language.

**3. It reads files, it starts nothing.** The window reads the registry through `@beifahrer/local`
(shared with the CLI), refreshes on a `Gio.FileMonitor` event and at least every 2 s, and has no
network access at all. No telemetry and no update check; updates arrive through the package manager.

**4. The status page walks the ladder of ADR 0015 §5**: no session and a session without a browser are
alarms that say what to do next (ADR 0014); a connected browser is the quiet state ("Ready"), with the
sessions listed under it.

**5. Every string the person reads is translated** (en, de), from a catalog of the app's own in
`desktop/locales/`. What an AGENT reads stays English (ADR 0008). The extension's `_locales` are not
reused: its keys are the browser UI's, and putting the app's into it would ship them in the extension.
A test fails when a key or placeholder exists in one language only.

**6. It is its own package.** `gjsify ship` takes one `kind` per project (app or cli) and documents no
second binary ([desktop-app-spikes.md](../desktop-app-spikes.md), S2), so the window ships as its
own project with its own application id. The window is the product a person looks for, so it
takes the short id, `eu.jumplink.beifahrer`; the CLI is `eu.jumplink.beifahrer.Cli`. A Flatpak id can
be held once, which is why the two cannot share one. A person installs either or both. Packaging is not part of this decision.

**7. "Check connection" is a read through the normal gates, not a back door.** The Status page has a
button that starts a short session of its own (the same bridge, port range and token as any agent
session, not announced in the registry), asks each connected browser for `tabs.list` and ends the
session. It changes no policy and reads none: a pause, a switched-off feature or a site level comes back
as the browser's refusal and is shown as that answer, with no button to lift it (§ 2, ADR 0005). It is
the one place the window talks to a browser, and only at the person's click.

**8. Settings are the bridge's own, in `settings.json`, read by the window and by `beifahrer`.** The
dialog (`Adw.PreferencesDialog`, from the primary menu, `Ctrl+,`) holds the port range, whether the Agent
page's snippet starts with `--allow-write`, and a language override (plus the autostart switch of
[ADR 0024](0024-the-window-stays-in-the-background.md) where the system has one). Rules:

- **Where.** `settings.json` in `configDir()`, beside the pairing token, not in `window.json`: that file
  holds the window's own memory (autostart, setup), and `beifahrer` must read these values without
  knowing the window. It holds no secret and no policy; losing it costs the defaults, so it is not a
  `secret` or `state` file and needs no backup entry. Written whole, atomically, mode 0600, only when
  the person changes a value, and minimal: a value equal to the default is stored as "not set", so a
  later default change is followed.
- **One range for both.** `beifahrer` resolves the range as flag, then `BEIFAHRER_PORT*`, then
  `settings.json`, then the defaults, so a range chosen in the window is the one an agent session binds.
  The extension still has its own "Ports" field (the browser cannot read this file); the dialog says
  the numbers must match. A running session keeps its port.
- **Validation, fail closed field by field.** A missing, unparseable or non-object file is the defaults.
  A field of the wrong type or outside what `parsePortRange` accepts (port 1024 to 65535, count 1 to 64,
  range ending at 65535) is "not set" and the other fields are kept; a malformed value never widens the
  range. The dialog clamps instead of failing: a count that would run past 65535 is shortened.
- **The default of a snippet is not a grant.** `allowWrite` only pre-selects the switch on the Agent page.
  What an agent may do is decided in the browser (ADR 0005); the dialog has no field for a pause, a
  feature or a site level, and a test pins the field list.
- **Language** applies at the next start; the system's list is the default.

## Consequences

- The window shows what the BRIDGES know. Whether Beifahrer is paused is visible in the browser's
  toolbar button and nowhere else, and the window does not pretend otherwise.
- Measured on macOS arm64 only (GJS and node-gi). Windows and Linux have not run it.
- The application id is a public identity once published; changing it later means a new app.
