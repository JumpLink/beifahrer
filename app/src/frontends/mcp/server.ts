/**
 * The beifahrer MCP server: stdio towards the agent, the loopback bridge towards the browsers.
 *
 * Two gates, and they are independent on purpose:
 * - HERE, the read-only gate: without BEIFAHRER_MCP_ALLOW_WRITE=1 / --allow-write the write tools
 *   do not even exist in tools/list.
 * - IN THE BROWSER, the per-origin policy and the confirmation window. The agent can switch the
 *   first one on in its own config; it can never switch the second.
 *
 * The gate and the stdio lifecycle are `@gjsify/mcp`'s since 0.54.0 — this file was the third
 * verbatim copy of postbote's, and two references of one safety gate are two places to fail open.
 * What stays here is beifahrer's own: which tools the server registers, and what each answers
 * with. The result helpers (`text`, `failure`, `answer` in tools.ts) are NOT the package's, and
 * must not become them: a `forbidden` answers `forbidden: … [origin=… have=… need=…]`, which
 * `mcpError`'s `{"error": …}` cannot carry, and a plain string passes through unquoted, which
 * `mcpSuccess`'s `JSON.stringify` would not. Both are load-bearing for an agent that has to
 * explain the refusal to the person.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyReadOnlyGate, serveStdio } from '@gjsify/mcp';
import { describeRange, type PortRange } from '@beifahrer/core';

import { desktopSource } from '../../bridge/desktop.ts';
import { listenInRange, type Bridge } from '../../bridge/bridge.ts';
import { labelOverride, sessionLabel } from '../../bridge/session.ts';
import { loadOrCreateToken, tokenPath } from '../../bridge/token.ts';
import { VERSION } from '../../version.ts';
import { registerTools, type BridgeHandle } from './tools.ts';

const SERVER_NAME = 'beifahrer';

export function createMcpServer(handle: BridgeHandle, allowWrite: boolean): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  // Before any registration — the gate wraps registerTool, so anything registered earlier would
  // slip past it. It fails CLOSED: a tool whose author forgot the annotation goes missing from
  // `tools/list`, which gets noticed, instead of a mutation being quietly reachable.
  applyReadOnlyGate(server, allowWrite);
  registerTools(server, handle);
  return server;
}

const log = (message: string) => console.error(`[${SERVER_NAME}] ${message}`);

/**
 * Bind this session's own bridge on the first free port of the range. A full range is not fatal:
 * every tool call tries again (a session may have ended meanwhile), and its error says why it
 * failed, which the agent can relay.
 */
export async function startBridge(
  range: PortRange,
  client: string,
  opts: { browserWaitMs?: number; lazy?: boolean } = {},
): Promise<BridgeHandle> {
  const { token } = loadOrCreateToken();
  const handle: BridgeHandle = { bridge: null };
  let started: Bridge | null = null;
  const bind = async () => {
    try {
      started = await listenInRange(range, {
        token,
        version: VERSION,
        desktop: desktopSource(),
        label: sessionLabel(client),
        browserWaitMs: opts.browserWaitMs,
      });
      started.on('error', (err: Error) => log(`bridge error: ${err.message}`));
      handle.bridge = started;
      handle.unavailable = undefined;
      handle.relabel = (name) => {
        if (!labelOverride()) started?.setLabel(sessionLabel(name));
      };
      log(
        `session "${started.session.label}": bridge on 127.0.0.1:${started.port} (range ${describeRange(range)})`,
      );
    } catch (err) {
      handle.unavailable = (err as Error).message;
      log(handle.unavailable);
    }
  };
  handle.retry = bind;
  // Lazy: bind on the first call that needs a browser (`beifahrer tool --list` never does).
  if (opts.lazy) return handle;
  await bind();
  if (handle.bridge) log(`token: ${tokenPath()}`);
  return handle;
}

export async function startMcpServer(opts: { range: PortRange; allowWrite?: boolean }): Promise<void> {
  const allowWrite = opts.allowWrite === true || process.env.BEIFAHRER_MCP_ALLOW_WRITE === '1';
  const handle = await startBridge(opts.range, 'mcp');
  const server = createMcpServer(handle, allowWrite);
  // The client says who it is only in the MCP handshake, after the bridge is up: rename then.
  server.server.oninitialized = () => {
    const name = server.server.getClientVersion()?.name;
    if (name) handle.relabel?.(name);
  };
  await serveStdio(server, SERVER_NAME);
}
