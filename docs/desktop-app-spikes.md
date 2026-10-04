# Desktop app: spike results

What was MEASURED before designing the native Adwaita app, and what was not. Probe sources:
[probes/adw-window/](../probes/adw-window/). Measured 2026-10-04 on macOS arm64 (Homebrew `gjs`,
`gtk4`, `libadwaita`, gjsify 0.54.0).

## S1: does an Adwaita window run under node-gi?

`runAdwaitaApp` from `@gjsify/adwaita-app` with an `Adw.ApplicationWindow`, `createNavShell`, two
`Adw.StatusPage`s and a self-quit after 1.5 s, built with `--app gjs` and `--app node`.

| Host | GJS | node-gi |
|---|---|---|
| macOS arm64 | window built, exit code 0 | window built, exit code 0 |
| Windows x64 | not measured (no host here; GJS does not exist there) | not measured |
| Linux | not measured by this spike | not measured by this spike |

The package README still says `node=none`; on macOS that is out of date, not wrong about
Windows. A `Gdk-WARNING … skipped frame` appears on both and is harmless for a one-frame probe.
The probe's `runtime=` line prints `gjs` under node too, because node-gi defines a global
`imports`: do not branch on it.

## S2: one project, GUI launcher AND a CLI on PATH?

Not supported by the gjsify docs read (ship overview, Linux packages, both Flatpak guides, CLI
reference): `kind` is `app` or `cli`, `command` is a single string, and no key names a second
binary. Read through a free model and not re-checked against gjsify's source, so treat "no key" as
"none documented".

**Decision for the plan:** two ship projects. `app/` stays the headless CLI package (`kind: cli`,
`beifahrer` on PATH); the desktop app becomes its own workspace with its own appId. A user installs
one or both.

## S3: registry liveness and change notification

- `Gio.FileMonitor` on a directory (macOS: kqueue) reports create, change and delete of a file
  within about 7 ms, on GJS and on node-gi. A file written atomically (`GLib.file_set_contents`)
  also reports its temp file and several duplicates, so a reader must match the exact
  `<id>.json` name and debounce.
- Not measured: Windows (`ReadDirectoryChangesW` backend), Linux inotify (expected to behave, not
  checked), and anything across the Flatpak boundary.
- `flock` as the liveness proof is NOT available from `node:fs`; it would need a native module.
  **Recommendation:** a heartbeat instead. The bridge rewrites `updatedAt` in its registry file every
  few seconds and a reader treats a file older than three beats as dead. It needs no pid (a
  Flatpak app has another PID namespace) and no lock, and works on all three systems. The
  bridge deletes its file on a clean exit; the heartbeat covers a crash. To be written into ADR 0015.
