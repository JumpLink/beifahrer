# 0015: A registry of live sessions, for anything that wants to look

- **Status:** accepted
- **Date:** 2026-10-04
- **Relates to:** [ADR 0007](0007-one-connection-per-agent-session.md) (no daemon, one bridge per
  agent session), [ADR 0005](0005-the-person-sees-and-stops-the-agent.md) (only the person pauses and
  resumes), [ADR 0014](0014-not-connected-speaks-first.md) (a missing connection is not quiet)
- **Asked for by:** the person, 2026-10-04: a native desktop app and `beifahrer status` that say
  whether Beifahrer is running, which agent sessions exist and which browsers hang on them.

## Context

There is no daemon (ADR 0007). Each agent session starts its own `beifahrer mcp`, on its own port,
and it ends with the session. So "is Beifahrer running?" has no single process to ask: it means
"which bridges are alive, and which browsers are connected to each". Today only the browser knows
(the extension's connection table) and the agent knows (`browsers_list`, one session at a time).
A window, a tray icon or `beifahrer status` run by the person has nothing to read.

Three constraints shape the answer:

- It has to work on Linux, macOS and Windows, on GJS and on Node, with no native module.
- A reader may live in another PID namespace: a Flatpak app does not see the host's pids, so a pid
  proves nothing there.
- Anything it exposes is data about what the person's agents are doing, so it must stay local and
  must never carry what the bridge does not hand an agent either: the pairing token, page content,
  URLs, call arguments.

## Decision

**1. One file per live bridge, in a per-user runtime directory.** `registryDir()`:
`$XDG_RUNTIME_DIR/beifahrer/sessions` when that is set, else `<tmpdir>/beifahrer-<user>/sessions`
(macOS and Windows have no `XDG_RUNTIME_DIR`; their per-user temp directory is shared by every
process of the person). The directory is created `0700`, the files `0600`. The file is named
`<instance>.json` (`AgentSession.instance`, ADR 0007), so two bridges never share one.

**2. What a file holds**, schema version 1, and nothing else:

```
{ v: 1, instance, label, pid, port, startedAt, updatedAt, bridgeVersion,
  browsers: [{ id, family, name, version, extensionVersion, connectedAt }] }
```

`label` is "claude-code · werkstatt": the client's name and the working directory's basename, which
the person already sees in the popup. It can name a private project, which is why the directory is
`0700` and why the registry never leaves the machine. `pid` is informational. There is no token, no
URL, no tab, no method list, no argument and no result.

**3. Liveness is a heartbeat, not a pid and not a lock.** The bridge rewrites its file (atomically:
temp file, then rename) when its session or browsers change and at least every `HEARTBEAT_MS` (5 s),
stamping `updatedAt`. A reader treats an entry as alive while `now - updatedAt <= STALE_MS` (three
beats). A clean exit, SIGINT and SIGTERM delete the file (measured on GJS: a signal skips `exit`
handlers, so the bridge handles the signals itself); a crash or SIGKILL leaves it, and the heartbeat is
what lets a reader see through that. `flock` was the first idea and is out: `node:fs` has no lock, and a native module
for it would be the only one in the project. A start also removes files that have been dead for more
than a minute; a READER never deletes anything.

**4. Readers are read-only, and the contract is the file.** `parseRegistryEntry` is fail-closed like
`parsePolicy`: a file that does not parse, has another `v`, or lacks a field is dropped, never
repaired. A reader that sees a newer `v` ignores that file rather than guessing. Change
notification is the reader's choice: `Gio.FileMonitor` where it exists, or polling every 2 s.
Measured on macOS only ([desktop-app-spikes.md](../desktop-app-spikes.md)).

**5. The registry says what the BRIDGE knows, so it cannot say "paused" or "all sites".** Neither
reaches the bridge: the extension's hello carries no pause and no grant, and the bridge learns of a
pause only from a refused call. Reporting them would need a protocol change, and a status that
guessed would show the person a state they cannot trust. So a registry reader's ladder
(`presenceOf`, core) has the rungs the bridge can know, loudest first:

1. **no bridge** — no live entry: no agent session is running, so no agent can use the browser;
2. **no browser** — live bridges, but none has a browser connected: the extension is not paired,
   not running, or has dismissed these sessions;
3. **ready** — at least one live bridge with at least one browser.

Rungs 1 and 2 are alarms in the sense of ADR 0014 (a missing connection is not a quiet state); a
reader shows the next step, not an empty list. The extension's own ladder (`alarmOf`) is
unchanged and remains the only place that knows about a pause.

**6. Under Flatpak the directory is granted explicitly:** `--filesystem=xdg-run/beifahrer:create`,
next to the config-directory grant, because the sandbox's own `XDG_RUNTIME_DIR` is not the host's.
Not measured: a real Flatpak run.

## Consequences

- A second reader (a tray icon, a GNOME Shell extension) needs no change in the bridge.
- A bridge that is killed hard shows as alive for up to `STALE_MS`. Acceptable: the status is for a
  person's eyes, and the agent and extension have their own, faster signals.
- Every bridge now writes a small file every five seconds while it lives. It stops when the process
  stops, and a failed write is reported once and never stops the bridge: the registry is an
  observer, and a full disk must not take an agent session down.
- The path is part of the contract (`BEIFAHRER_REGISTRY_DIR` overrides it, for tests and for a
  person who wants it elsewhere).
