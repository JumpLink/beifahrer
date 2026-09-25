/**
 * The beifahrer MCP server: stdio towards the agent, the loopback bridge towards the browsers.
 *
 * Two gates, and they are independent on purpose:
 * - HERE, the read-only gate (runtime.ts): without BEIFAHRER_MCP_ALLOW_WRITE=1 / --allow-write the
 *   write tools do not even exist in tools/list.
 * - IN THE BROWSER, the per-origin policy and the confirmation window. The agent can switch the
 *   first one on in its own config; it can never switch the second.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_PORT } from '@beifahrer/core';

import { SharedBridge } from '../../bridge/shared.ts';
import { loadOrCreateToken, tokenPath } from '../../bridge/token.ts';
import { VERSION } from '../../version.ts';
import { applyReadOnlyGate, serveStdio } from './runtime.ts';
import { registerTools, type BridgeHandle } from './tools.ts';

const SERVER_NAME = 'beifahrer';

export function createMcpServer(handle: BridgeHandle, allowWrite: boolean): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  // Before any registration — the gate wraps registerTool.
  applyReadOnlyGate(server, allowWrite);
  registerTools(server, handle);
  return server;
}

/**
 * Join the browser connection: own the port (hub), or relay through the session that owns it
 * (peer). A failed first election is not fatal — every tool call elects again, and its error says
 * why it failed, which the agent can relay.
 */
export async function startBridge(port: number): Promise<BridgeHandle> {
  const { token } = loadOrCreateToken();
  const bridge = new SharedBridge({
    port,
    token,
    version: VERSION,
    log: (message) => console.error(`[${SERVER_NAME}] ${message}`),
  });
  try {
    await bridge.start();
    console.error(`[${SERVER_NAME}] token: ${tokenPath()}`);
  } catch (err) {
    console.error(`[${SERVER_NAME}] ${(err as Error).message}`);
  }
  return { bridge };
}

export async function startMcpServer(opts: { port?: number; allowWrite?: boolean } = {}): Promise<void> {
  const port = opts.port ?? (Number(process.env.BEIFAHRER_PORT) || DEFAULT_PORT);
  const allowWrite = opts.allowWrite === true || process.env.BEIFAHRER_MCP_ALLOW_WRITE === '1';
  const handle = await startBridge(port);
  await serveStdio(createMcpServer(handle, allowWrite), SERVER_NAME);
}
