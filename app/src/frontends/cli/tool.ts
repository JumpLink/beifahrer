/**
 * `beifahrer tool <name> [json]` — run ONE MCP tool from the command line.
 *
 * For agents whose session has no beifahrer MCP server (it was added after the session started,
 * or the agent is not an MCP client at all) and for scripts. It is not a second implementation:
 * the real MCP server and an MCP client are wired together in this process over the SDK's
 * in-memory transport, so the tool, its gates (the read-only gate here, and every browser-side
 * gate) and its output are exactly what an MCP client gets. The bridge joins the shared hub as a
 * peer, like any other session.
 *
 *   beifahrer tool --list
 *   beifahrer tool tabs_list
 *   beifahrer tool recipes_for_tab '{"tabId": 78}'
 *   beifahrer tool --allow-write recipe_run '{"tabId": 78, "id": "openproject/add-comment", "params": {"text": "…"}}'
 */

import type { CommandModule } from 'yargs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_PORT } from '@beifahrer/core';

import { createMcpServer, startBridge } from '../mcp/server.ts';

interface Args {
  name?: string;
  args?: string;
  list?: boolean;
  port?: number;
  'allow-write'?: boolean;
}

function finish(code: number): never {
  return process.exit(code);
}

export const toolCommand: CommandModule<object, Args> = {
  command: 'tool [name] [args]',
  describe: 'Run one MCP tool without an MCP client (same tools, same gates) — or --list them',
  builder: (y) =>
    y
      .positional('name', { type: 'string', describe: 'tool name, e.g. tabs_list' })
      .positional('args', { type: 'string', describe: 'JSON object with the tool arguments' })
      .option('list', { type: 'boolean', describe: 'List the tools and their descriptions' })
      .option('port', {
        type: 'number',
        describe: `Loopback port (default ${DEFAULT_PORT}, or $BEIFAHRER_PORT)`,
      })
      .option('allow-write', {
        type: 'boolean',
        describe: 'Expose the write tools, as `mcp --allow-write` does',
      }),
  handler: (argv) => {
    void (async () => {
      const port = argv.port ?? (Number(process.env.BEIFAHRER_PORT) || DEFAULT_PORT);
      const allowWrite = argv['allow-write'] === true || process.env.BEIFAHRER_MCP_ALLOW_WRITE === '1';
      let input: Record<string, unknown> = {};
      if (argv.args) {
        try {
          input = JSON.parse(argv.args) as Record<string, unknown>;
        } catch (err) {
          console.error(`args must be a JSON object: ${(err as Error).message}`);
          return finish(2);
        }
      }
      const handle = await startBridge(port);
      const server = createMcpServer(handle, allowWrite);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'beifahrer-tool', version: '0' });
      await server.connect(serverSide);
      await client.connect(clientSide);

      const { tools } = await client.listTools();
      if (argv.list || !argv.name) {
        for (const t of tools) console.log(`${t.name}\n    ${t.description ?? ''}\n`);
        return finish(0);
      }
      if (!tools.some((t) => t.name === argv.name)) {
        const hint = allowWrite ? '' : ' (write tools need --allow-write)';
        console.error(`no tool "${argv.name}"${hint} — \`beifahrer tool --list\` shows them`);
        return finish(2);
      }
      const res = await client.callTool({ name: argv.name, arguments: input });
      for (const c of (res.content ?? []) as { type: string; text?: string; mimeType?: string }[]) {
        console.log(c.type === 'text' ? c.text : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ''}]`);
      }
      return finish(res.isError ? 1 : 0);
    })().catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      finish(1);
    });
  },
};
