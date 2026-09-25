# 0007: One connection per agent session

- **Status:** accepted. Supersedes [ADR 0003](0003-share-one-bridge-between-agent-sessions.md).
- **Date:** 2026-09-25
- **Decided by:** the person, 2026-09-25: "the extension should accept several connections".

## Context

ADR 0003 let several agent sessions share one browser connection: the `beifahrer mcp` that bound
the port became the hub, and every later one relayed its calls through it. It worked, and it
broke as soon as two sessions ran different builds, which happens daily: the person runs several
agent sessions at once, some for hours, and each starts its `beifahrer mcp` from whatever bundle
was current when it started.

Measured on 2026-09-25 ([issue #13](https://github.com/JumpLink/beifahrer/issues/13)): a session
built with recipes relayed `recipes_for_tab` through a hub started from an older bundle. The hub
did not know `page.find` and answered `invalid: not a valid agent request`, although the
extension had announced `page.find` in its hello. The hub lives as long as its session, so every
version skew between sessions silently switched new features off until the oldest session ended.

Patching the hub to relay unknown methods would fix this one case, but a hub still sits between
every session and the browser. Its protocol version, its timeouts and its bugs apply to everyone,
and so does its lifetime.

## Decision

**Every agent session's bridge binds its own port, and the extension keeps one WebSocket per
bridge.** No hub, no relay and no election. One mechanism.

### Ports

- A range of loopback ports, default **47813–47822** (base 47813, 10 ports). The bridge reads
  `--port`/`BEIFAHRER_PORT` (the first port) and `--port-count`/`BEIFAHRER_PORT_COUNT`. The
  extension's options page has the same two fields. Both sides parse them with `parsePortRange`
  (core), which falls back field by field, so a malformed value never widens the range.
- A bridge binds the first free port of the range (`bindFirstFree`, core; `listenInRange`,
  app). Any bind error moves on to the next port, because on GJS "taken" is only recognisable
  from a localised message. A full range is a clear error that names the range and how to widen
  it. `beifahrer mcp` retries the bind on the next tool call, since a session may have ended in
  the meantime.
- `beifahrer tool`, `call` and `serve` bind a port of the range the same way. `call` and a
  `tool` call wait for the extension to find them, bounded by `--wait` (default 20 s). Every
  bridge call waits up to 7 s for a browser when none is connected yet, so the first call of a
  session that has just started does not fail for being early.

### Probing

The extension probes the range in rounds (`ConnectionTable`, core, pure; sockets in
`extension/src/bridge-client.ts`). The first round runs 1 s after a change, then each quiet round
waits one step longer, up to 5 s. A connect to a closed loopback port fails at once, so a round
over ten ports costs next to nothing. The only URL ever built is `ws://127.0.0.1:<port>/` with a
port from the range.

- A port whose bridge refused the token or the protocol version is retried every 30 s, not every
  round, because a bridge with the right token may take the port later.
- Each socket does the full admission on its own (see Security) and pings every 20 s. In MV3 that
  keeps the service worker awake while any session is connected. With none connected, an alarm
  every 30 s (Chromium's minimum) wakes it to probe.
- A request arrives on a socket, and its answer goes back on the same socket. The extension
  serves every session with its own method set and protocol version, so a session started from
  an older bundle keeps working for the methods it knows while a newer session uses newer ones.

### Sessions the person can see

- The welcome carries the session: `{ label, pid, instance, startedAt }`. The label defaults to
  the MCP client's name and the working directory's basename, for example
  "claude-code · werkstatt". The MCP client names itself only in the MCP handshake, after the
  bridge is up, so the bridge then sends a `session` frame with the new label. The environment
  variable `BEIFAHRER_SESSION_LABEL` overrides it. The extension treats the label as untrusted
  text: `cleanSessionLabel` strips control and bidi characters and caps it at 80 characters, and
  the UI sets it as text only.
- The popup lists the connected sessions: label, since when, and **Disconnect**. The activity log
  records which session made each request. The in-page pill names it ("beifahrer
  (claude-code · werkstatt) is reading"), inside its closed shadow root.
- **Disconnect** closes that socket and dismisses that bridge's `instance`. The port is still
  probed, with `dismissed: <instance>` in the hello. That bridge closes with `CLOSE.dismissed`
  (4403) before it registers the connection, so none of its calls can reach the browser. A new
  bridge on the same port (the session restarted) has another instance and is welcome again. A
  probe that finds nothing listening clears the dismissal. A bridge from before this ADR has no
  instance, so the extension closes it after its welcome until nothing listens on its port.
- The toolbar shows "active" while any session is active. Pause and the feature switches apply
  to all sessions, unchanged: they are the person's switches (ADR 0005).
- `browsers_list` shows this session's port, label and its direct browser connections. The
  multi-browser `browser` parameter stays.

### Security

Unchanged per connection, and simpler than ADR 0003's two roles:

1. **Loopback only.** Each bridge binds `127.0.0.1`, and `verifyClient` checks the remote
   address again.
2. **An extension Origin**, checked in the handshake. A web page always sends its own Origin, and
   a local process that sends none is refused there as well. With no agent role left, nothing
   after the handshake needs to read the Origin (`roleAllowed` and `handshakeOriginKind` are gone).
3. **The pairing token**, compared in constant time, before the dismissal is looked at. Every
   bridge reads the same token file, so every session needs the same token; one that reads
   another file is refused with 4401, and the extension retries it only every 30 s.

The bridge still holds no policy. Each session's MCP read-only gate decides which tools that
session exposes, and the extension decides every page access.

## Consequences

- Removed: `app/src/bridge/shared.ts` (`SharedBridge`, `HubClient`), the `agent-hello`,
  `agent-welcome`, `agent-call`, `agent-status` and `agent-reply` frames, `parseFirstFrame`,
  `roleAllowed`, `originKind`, `answerAgentRequest`, `handshakeOriginKind` and their tests.
  `PROTOCOL_VERSION` stays 1: the new fields are optional, so an older bridge still pairs with a
  newer extension and the other way round.
- An older extension only connects to its single configured port. Reload the extension so that
  it probes the range, and restart old agent sessions: an old `beifahrer mcp` on 47813 is a hub
  that a new session no longer relays through.
- The dev browser (`gjsify workspace beifahrer-extension dev`) moves to 47830–47839, because
  47814 now lies inside the default range.
- A second browser connected to the same range means every call needs `browser`, as before.
- A browser holds one socket per session. Ten sessions are ten idle sockets and ten pings every
  20 s, which costs nothing measurable.
- Measured: unit tests on GJS and Node for the port range, `bindFirstFree`, `listenInRange`, the
  connection table (probe cadence, refusals, dismissal), the session label and the dismissed
  hello. The e2e runs, in headless Chromium and Firefox, two MCP sessions, a `beifahrer tool` and
  a faked older bridge at once, each succeeding on its own connection. A newer session uses
  `page_find` while the older bridge knows only `tabs.list`. When one session ends the others keep
  working. A disconnected session stays out, and its restart gets back in.
