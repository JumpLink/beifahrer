# 0024: The window stays in the background and shows the status

- **Status:** accepted (decided by the person on 2026-11-02). The Flatpak step (§ 5) needs no new
  gjsify code; the status icon waits for
  [gjsify ADR 0129](https://github.com/gjsify/gjsify/blob/main/docs/adr/0129-a-status-icon-on-every-desktop.md).
- **Date:** 2026-11-02
- **Refines:** [0017](0017-native-desktop-app.md) (the window's lifetime; § 2 and § 3 still hold)
- **Relates to:** [0007](0007-one-connection-per-agent-session.md) (one bridge per agent session, no
  daemon), [0015](0015-session-registry.md) (what the window reads),
  [0023](0023-onboarding-for-beginners.md) (the window is the beginner's entry point)
- **Asked for by:** the person, 2026-11-02: "Experts can use the CLI for the MCP server; everybody
  else uses the UI, which runs in the background." Asked which model, the person chose the status
  in the background, not a window that hosts the MCP server.

## Context

The agent starts `beifahrer mcp` itself over stdio, so nobody has to keep a server running: once the
setup assistant (ADR 0023) has written the agent's config, the bridge appears whenever the agent
needs it. What a beginner lacks is a place that stays visible and says whether it works: is an
agent session there, is a browser connected, what is the pairing token. Today that place goes away
with the window: `close-request` in `app/src/window/main.ts` stops the registry watch and the
application quits.

Two other models were weighed and not chosen. A window that hosts the MCP server over local HTTP
would replace ADR 0007 and ADR 0017 § 3, add an HTTP surface with its Origin and DNS-rebinding
questions, and make autostart mandatory. A window that is the one bridge, with `beifahrer mcp` as a
relay to it, is ADR 0003's hub, which a version mismatch already broke (#13).

## Decision

**1. The bridge stays with the agent.** ADR 0007 is unchanged. The window never hosts MCP, never
starts or stops a bridge, and still only reads the registry (ADR 0017 § 3). It gains no right ADR
0017 § 2 withholds: no pause, no resume, no site level.

**2. Closing the window keeps Beifahrer running only where the person can get it back.** On
`close-request` the app calls `Gio.Application.hold()` and hides the window if, and only if, one of
these holds:

- a status icon is shown (`StatusIcon.available` is `true`, gjsify ADR 0129), or
- in the Flatpak, the Background portal granted the request (`Xdp.Portal.request_background`), so
  GNOME lists Beifahrer under Background Apps.

Otherwise closing quits, as today. An invisible process the person cannot find is worse than none.
"Quit" in the window's menu and in the icon's menu always ends the process (`release()`, then quit).

**3. Windowless, it shows the ladder of ADR 0015 § 5.** The rung the window would show becomes the
icon's tooltip and the portal's status line (`set_background_status`, at most 96 characters), for
example "Ready: Firefox connected, 2 agent sessions". The two alarm rungs (no session, no browser)
switch the icon to a second themed icon, because gjsify ADR 0129 refuses badges. The icon's menu
holds two entries: "Show window" and "Quit". Every string is translated (ADR 0017 § 5).

**4. Autostart is off until the person turns it on.** A switch in the window, off by default.
Turning it off removes the autostart entry completely. On Linux it is the `autostart` flag of the
Background portal; on macOS and Windows it waits for gjsify's Background drivers.

**5. Order.** The Flatpak first: `hold()` plus `request_background` work on GJS today through
libportal, with no new gjsify package. Then deb/rpm on desktops with a StatusNotifierItem host,
once `@gjsify/status-icon` has its Linux cuts. macOS and Windows follow their drivers; until then
rule 2 makes closing quit there.

## Consequences

- A beginner closes the window and still sees, in the panel or GNOME's background list, whether the
  browser and the agent are connected. The expert's CLI path does not change.
- On GNOME, a deb/rpm install without the AppIndicator extension has neither an icon nor a
  background-list entry, so closing quits there. The window says nothing about it; this is a
  property of the desktop, not an error.
- The Flatpak manifest needs `--talk-name=org.kde.StatusNotifierWatcher` for the icon on KDE and
  other hosts.

## Open questions

1. What the ✕ in GNOME's Background Apps list does to the process (unverified). Beifahrer must treat
   it as Quit.
2. Whether the window should offer to turn on autostart after the first successful pairing, or
   only in its settings.
