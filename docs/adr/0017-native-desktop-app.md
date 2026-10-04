# 0017: A native desktop window that only looks

- **Status:** accepted
- **Date:** 2026-10-04
- **Relates to:** [ADR 0015](0015-session-registry.md) (what it reads),
  [ADR 0005](0005-the-person-sees-and-stops-the-agent.md) (only the person pauses and resumes),
  [ADR 0014](0014-not-connected-speaks-first.md) (a missing connection is not quiet),
  [ADR 0008](0008-ui-on-adwaita-web.md) (the browser UI is Adwaita too)
- **Asked for by:** the person, 2026-10-04: a native Adwaita app for beifahrer, not a web UI.

## Context

The extension shows the person what the agent does, but only inside the browser. Nothing on the
desktop says whether beifahrer is running, which agent sessions exist or whether a browser is
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

## Consequences

- The window shows what the BRIDGES know. Whether beifahrer is paused is visible in the browser's
  toolbar button and nowhere else, and the window does not pretend otherwise.
- Measured on macOS arm64 only (GJS and node-gi). Windows and Linux have not run it.
- The application id is a public identity once published; changing it later means a new app.
