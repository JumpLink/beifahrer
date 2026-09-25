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

import { Bridge } from '../../bridge/bridge.ts';
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

export async function startBridge(port: number): Promise<BridgeHandle> {
  const { token } = loadOrCreateToken();
  const bridge = new Bridge({ port, token, version: VERSION });
  try {
    await bridge.start();
    console.error(`[${SERVER_NAME}] bridge listening on 127.0.0.1:${port} (token: ${tokenPath()})`);
    return { bridge };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const unavailable =
      code === 'EADDRINUSE'
        ? `port ${port} is taken — most likely another agent session already runs a beifahrer bridge. ` +
          'Only one bridge can own the browser connection at a time; use that session, or stop it.'
        : `the bridge could not start: ${(err as Error).message}`;
    console.error(`[${SERVER_NAME}] ${unavailable}`);
    // Serve anyway: every tool then answers with this reason, which the agent can relay. Dying
    // here would leave the agent with a server that simply "failed to start".
    return { bridge: null, unavailable };
  }
}

export async function startMcpServer(opts: { port?: number; allowWrite?: boolean } = {}): Promise<void> {
  const port = opts.port ?? (Number(process.env.BEIFAHRER_PORT) || DEFAULT_PORT);
  const allowWrite = opts.allowWrite === true || process.env.BEIFAHRER_MCP_ALLOW_WRITE === '1';
  const handle = await startBridge(port);
  await serveStdio(createMcpServer(handle, allowWrite), SERVER_NAME);
}
