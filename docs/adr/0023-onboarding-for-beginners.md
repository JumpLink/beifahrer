# 0023: Onboarding for beginners: one package, a window that can write the config

- **Status:** accepted (decided by the person on 2026-11-01)
- **Date:** 2026-11-01
- **Refines:** [0017](0017-native-desktop-app.md) (§ 2 and § 3 partly superseded, § 6 superseded)
- **Relates to:** [0015](0015-session-registry.md) (what the window reads),
  [0005](0005-the-person-sees-and-stops-the-agent.md) (only the person pauses and resumes)
- **Asked for by:** the person, 2026-11-01: someone who is not technical must get Beifahrer running
  on Linux, macOS and Windows without opening a terminal. The CLI stays for people who want it.

## Context

Today a person installs two things and then edits a file by hand. Measured on v0.1.15:

- **Two packages collide.** Both macOS dmgs contain an app literally named `Beifahrer.app` (bundle ids
  `eu.jumplink.beifahrer.Cli` and `eu.jumplink.beifahrer`), so the second one replaces or duplicates
  the first in `/Applications`. Both Windows MSIs install into the same `C:\Program Files\Beifahrer`.
- **The bridge package does nothing visible when opened.** Double-clicking it on macOS or Windows shows
  no window and no hint; the headless CLI was started by a person who has no terminal.
- **The window only shows a snippet.** Its Agent page prints the config for each coding agent and the
  file it goes in ([agents.ts](../../packages/core/src/agents.ts)); the person still has to find the
  file and paste. ADR 0017 § 2 and § 3 made the window view-only, which was right while the question
  was whether it may touch policy. It is the wrong answer to "how does a beginner finish setup".
- **The command in that snippet is now correct per host** (PR #159): `serverSpec`, `Install` and
  `launcherOf` in `packages/core/src/agents.ts` resolve the macOS launcher
  (`/Applications/Beifahrer.app/Contents/MacOS/beifahrer`), the Windows `beifahrer.exe` next to the
  running node, `flatpak run eu.jumplink.beifahrer.Cli mcp` inside a Flatpak, and plain `beifahrer`
  for deb/rpm.

Also measured, for the record:

- `beifahrer mcp` over stdio works with the GUI-subsystem `beifahrer.exe` on Windows when the
  streams are redirected, which is how an agent starts it.
- On macOS the `.dmg` is stapled but the `.app` inside carries no ticket, so Gatekeeper's offline
  check of the app is unverified.
- The first launch of the macOS window took 1 min 24 s to check in on an M4. The cause is not
  established.

## Decision

**1. One package per OS, with the window and the bridge CLI inside.** One application id,
`eu.jumplink.beifahrer`. Opening it opens the window; the same package carries the `beifahrer` CLI,
which a coding agent starts with `mcp`. A double-click on the CLI binary opens the window (or shows a
hint that points to it) instead of doing nothing. This replaces `beifahrer-*` plus
`beifahrer-desktop-*`, and ADR 0017 § 6, which split them because `gjsify ship` took one binary per
project. The Flatpak id `eu.jumplink.beifahrer.Cli` goes away with the split; the Flatpak command in
`serverSpec` then becomes `flatpak run eu.jumplink.beifahrer mcp`.

**2. The window may write an agent's config, on request.** Only after the person confirmed, with a
backup of the old file and the diff shown first. It never writes unasked, never on open, never for
an agent the person did not pick. The command written is the one `serverSpec` produces for this
host (the macOS and Windows launchers, Flatpak, deb/rpm above), so the page that shows the snippet
and the button that writes it cannot say different things. This supersedes ADR 0017 § 2 where it
says the window is only a view and ADR 0017 § 3 where it says the window "starts nothing" and reads
files only: it now also writes one kind of file, an agent's MCP config.

**3. Making the command available in a terminal is optional and the person's own click.**
On macOS a symlink (for example in `~/.local/bin`), on Windows an entry in the user's `PATH`. Never
silent, never at install time from the app, and reversible. A machine-wide `PATH` entry from the MSI
is an opt-in installer feature, not a default. deb/rpm already put `beifahrer` on `PATH`.

**4. Unchanged from ADR 0017.** The window has no network access, no telemetry and no update check,
and it cannot pause, resume, switch a feature or change a site's level; those stay in the browser
(ADR 0005). Writing an agent's config is the only addition. The token is still paired by hand
(copy from the Browser page into the extension) until native messaging replaces it, which is a later
phase.

## Consequences

- **gjsify must ship several executables in one package**: a second binary under `Contents/MacOS` on
  macOS, an optional `PATH` feature in the MSI, and `bin/` entries in deb/rpm. Until it does, the
  single package cannot be built; that work is in gjsify, not here, and this repo's release workflow
  and `README.md` change with it.
- **Windows stays unsigned** until a certificate exists. SmartScreen warns on the installer and on
  the first start; the install docs must say so. This ADR does not plan around a certificate.
- **No tray, no background process.** That is deferred (phase 7) and will be a gjsify package behind a
  portal-first interface (gjsify ADR 0101). The window never depends on a tray icon.
- Writing a config is a new way for the window to damage a person's setup. The confirmation, the
  diff and the backup are the whole safety net, so a test must pin them: no write without all three.
- The existing `eu.jumplink.beifahrer.Cli` installs from v0.1.15 and earlier keep working until
  updated; their agents' configs name the old command and need the window's write once.
- The application id of the bridge (`eu.jumplink.beifahrer.Cli`) is public already. Dropping it is
  a deliberate break for Flatpak users of the CLI package.
