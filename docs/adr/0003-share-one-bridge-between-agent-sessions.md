# 0003: Share one bridge between agent sessions

- **Status:** superseded by [ADR 0007](0007-one-connection-per-agent-session.md): a hub from an older
  build blocked newer sessions ([#13](https://github.com/JumpLink/beifahrer/issues/13)), so every
  session now has its own port and connection. Kept for the reasoning. It replaced the last
  consequence of ADR 0001 ("a second session gets 'port in use'").
- **Date:** 2026-09-25

## Context

The person runs several agent sessions at once, and each one starts its own `beifahrer mcp` over
stdio. The extension connects to one fixed loopback port, and only one process can bind it. Until
now the first session got the browser, and every other session's tools answered "port taken".
Worse, when that first session ended, the browser connection was gone until some new session
happened to start.

Options considered:

| Option | Why not |
|---|---|
| The extension connects to several ports, one per session | the extension would need to discover sessions, and the person would see N connections for one browser |
| A separate long-running daemon that every `beifahrer mcp` talks to | one more process to install, start and keep alive. Whoever starts it first is already a daemon, and the kernel already decides who that is |
| Leader election over a lock file | a second mechanism next to the port, with stale-lock cleanup. Binding the port is atomic and the kernel frees it when the process dies |

## Decision

**Leader election by binding the port, with relay.**

- A `beifahrer mcp` that binds `127.0.0.1:<port>` is the **hub**. It accepts extensions as before
  and additionally **agent peers**.
- One that cannot bind connects to the hub as an agent peer and forwards `call(method, params,
  browser)` and `status()` over that socket (`agent-call`, `agent-status`, `agent-reply` in
  `packages/core/src/protocol.ts`). Results and wire errors come back unchanged, so a `forbidden`
  from the browser reaches the peer's agent as the same `forbidden`.
- **Failover.** When the hub's socket closes, the peer fails everything in flight at once. Nothing
  hangs, and the error says a write may or may not have reached the browser. Then the peer races
  to bind: one wins and becomes the hub, the rest become its peers. The extension already
  reconnects with a 1 s backoff (and a one-minute alarm for a sleeping MV3 worker), so it finds the
  new hub by itself. The peer re-elects at once instead of waiting for the next tool call, because
  the extension can only reconnect once something listens on the port.
- `browsers_list` shows the session's `role` (`hub` or `peer`), the hub's pid and how many
  `sessions` share the connection.

### Admission of agent peers

A peer must be admitted at least as strictly as an extension:

1. **Loopback only.** The server binds `127.0.0.1`, and `verifyClient` checks the remote address
   again.
2. **The same pairing token**, from the same token file, compared in constant time.
3. **A distinct hello** (`type: 'agent-hello'`).
4. **No Origin.** A local process sends none. A browser always sends one on a WebSocket handshake,
   so a web page can never arrive without it. `verifyClient` therefore lets "no Origin" through
   the handshake, but only so that the first frame can decide the role. `roleAllowed()` then
   accepts exactly two combinations: extension Origin + `hello`, and no Origin + `agent-hello`.
   A page Origin never gets past the handshake. An extension Origin with `agent-hello`, and no
   Origin with `hello`, are closed with 4401 before the token is compared.

The unit tests cover each refused combination: page Origin + agent hello, no Origin + extension
hello, extension Origin + agent hello, no Origin + agent hello + wrong token.

### Where the policy stays

The hub adds no gate for peers, and it holds no policy for its own agent either. A peer can do
exactly what the hub's own agent can do. Each session's MCP read-only gate still decides which
tools that session exposes, and the extension still decides every page access, with its
confirmation window. A local process that holds the token could have bound the port first anyway,
so relaying gives it nothing new. The hub still refuses a method missing from `REQUIRED_LEVEL`
(`parseAgentRequest`), and it never forwards the extension's token to a peer (`ConnectedBrowser`
has no token field).

## Consequences

- `beifahrer call` works while an agent session holds the port: it relays like any other peer.
  `beifahrer serve` still wants the port itself.
- A write in flight when the hub dies has an unknown outcome. The error says so rather than
  retrying on its own.
- Sessions must read the same token file. A peer the hub refuses with 4401 gets an error naming
  the token file, and it does not retry forever.
- The code is split so that the logic can be tested without sockets: `resolveBrowser`,
  `answerAgentRequest` and `PendingCalls` need no socket. `Bridge` is the hub, and `SharedBridge`
  (`app/src/bridge/shared.ts`) runs the election and the peer side.
- Measured: unit tests on GJS and Node. The e2e `shared` scenario starts two MCP servers against
  one headless Chromium. The second session's `tabs_list` goes through the hub, and after the first
  session exits the second takes over and the extension reconnects to it.
