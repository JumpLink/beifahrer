import { describe, expect, it } from '@gjsify/unit';

import { AGENTS, findAgent, serverSpec, snippetOf, userConfigPath } from '@beifahrer/core';

const withWrite = serverSpec({ allowWrite: true });
const readOnly = serverSpec({ allowWrite: false });
const agent = (id: string) => findAgent(id)!;

// The table is what a person pastes into another program's config. A shape that is wrong there fails
// silently on their side, so each shape is pinned to what the agent's own docs show.
export default async () => {
  await describe('agent catalog', async () => {
    await it('has unique ids, a docs link and a snippet that parses for every agent', async () => {
      expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
      for (const a of AGENTS) {
        expect(a.docs).toMatch(/^https:\/\//);
        const text = snippetOf(a, withWrite);
        if (a.shape !== 'codex') expect(JSON.parse(text) !== null).toBe(true);
        expect(text).toMatch(/--allow-write/);
      }
    });

    await it('leaves --allow-write out unless asked', async () => {
      for (const a of AGENTS) expect(snippetOf(a, readOnly)).not.toMatch(/allow-write/);
    });

    await it('uses mcpServers with command and args for Claude Code, Gemini, Cursor and Claude Desktop', async () => {
      for (const id of ['claude-code', 'gemini-cli', 'cursor', 'claude-desktop']) {
        expect(JSON.parse(snippetOf(agent(id), withWrite))).toStrictEqual({
          mcpServers: { beifahrer: { command: 'beifahrer', args: ['mcp', '--allow-write'] } },
        });
      }
    });

    await it('uses a local server with ONE command array under `mcp` for opencode', async () => {
      expect(JSON.parse(snippetOf(agent('opencode'), withWrite))).toStrictEqual({
        $schema: 'https://opencode.ai/config.json',
        mcp: { beifahrer: { type: 'local', command: ['beifahrer', 'mcp', '--allow-write'] } },
      });
    });

    await it('uses a TOML table for Codex', async () => {
      expect(snippetOf(agent('codex'), withWrite)).toBe(
        '[mcp_servers.beifahrer]\ncommand = "beifahrer"\nargs = ["mcp", "--allow-write"]',
      );
    });

    await it('uses `servers` with a stdio type for VS Code and `context_servers` for Zed', async () => {
      expect(JSON.parse(snippetOf(agent('vscode'), readOnly))).toStrictEqual({
        servers: { beifahrer: { type: 'stdio', command: 'beifahrer', args: ['mcp'] } },
      });
      expect(JSON.parse(snippetOf(agent('zed'), readOnly))).toStrictEqual({
        context_servers: { beifahrer: { command: 'beifahrer', args: ['mcp'] } },
      });
    });

    await it('names a user config file only where the docs did, never a guess', async () => {
      expect(userConfigPath(agent('claude-desktop'), 'darwin')).toBe(
        '~/Library/Application Support/Claude/claude_desktop_config.json',
      );
      expect(userConfigPath(agent('claude-desktop'), 'linux')).toBe(null);
      expect(userConfigPath(agent('vscode'), 'linux')).toBe(null);
      expect(userConfigPath(agent('codex'), 'freebsd')).toBe(null);
    });

    await it('gives a one-line command only where the agent has a non-interactive one', async () => {
      expect(agent('claude-code').cli!(withWrite)).toBe(
        'claude mcp add --transport stdio beifahrer -- beifahrer mcp --allow-write',
      );
      expect(AGENTS.filter((a) => a.cli).map((a) => a.id)).toStrictEqual(['claude-code']);
    });
  });
};
