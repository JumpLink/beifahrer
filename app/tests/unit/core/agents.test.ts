import { describe, expect, it } from '@gjsify/unit';

import {
  AGENTS,
  agentSections,
  commandInConfig,
  findAgent,
  launcherOf,
  serverSpec,
  shellQuote,
  snippetOf,
  supportsPlatform,
  userConfigPath,
} from '@beifahrer/core';

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

  await describe('command per install', async () => {
    const mac = '/Applications/Beifahrer.app/Contents/MacOS/beifahrer';
    const win = 'C:\\Program Files\\Beifahrer\\beifahrer.exe';

    await it('keeps `beifahrer` for deb/rpm, a checkout and an unknown host', async () => {
      expect(serverSpec({ allowWrite: false }).command).toBe('beifahrer');
      expect(serverSpec({ allowWrite: false, install: { platform: 'linux' } }).command).toBe('beifahrer');
      expect(
        serverSpec({ allowWrite: false, install: { platform: 'darwin', launcher: undefined } }).command,
      ).toBe('beifahrer');
    });

    await it('goes through `flatpak run` inside a Flatpak', async () => {
      const s = serverSpec({ allowWrite: true, install: { platform: 'linux', flatpak: true } });
      expect(s.command).toBe('flatpak');
      expect(s.args).toStrictEqual(['run', 'eu.jumplink.beifahrer', 'mcp', '--allow-write']);
    });

    await it('uses the absolute launcher of a macOS app bundle and a Windows program directory', async () => {
      expect(serverSpec({ allowWrite: false, install: { platform: 'darwin', launcher: mac } }).command).toBe(
        mac,
      );
      const s = serverSpec({ allowWrite: false, install: { platform: 'win32', launcher: win } });
      expect(s.command).toBe(win);
      expect(JSON.parse(snippetOf(agent('cursor'), s))).toStrictEqual({
        mcpServers: { beifahrer: { command: win, args: ['mcp'] } },
      });
      expect(snippetOf(agent('cursor'), s)).toMatch(/C:\\\\Program Files\\\\Beifahrer\\\\beifahrer\.exe/);
      expect(snippetOf(agent('codex'), s)).toMatch(
        /command = "C:\\\\Program Files\\\\Beifahrer\\\\beifahrer\.exe"/,
      );
    });

    await it('falls back to `beifahrer` when the launcher was looked for and not found', async () => {
      expect(serverSpec({ allowWrite: false, install: { platform: 'win32', launcher: null } }).command).toBe(
        'beifahrer',
      );
    });

    await it('finds the launcher beside the bundled node, and nowhere else', async () => {
      expect(launcherOf('darwin', '/Applications/Beifahrer.app/Contents/Helpers/Beifahrer')).toBe(mac);
      expect(launcherOf('win32', 'C:\\Program Files\\Beifahrer\\node.exe')).toBe(win);
      expect(launcherOf('darwin', '/usr/local/bin/node')).toBe(undefined);
      expect(launcherOf('linux', '/usr/bin/gjs')).toBe(undefined);
      expect(launcherOf('win32', null)).toBe(undefined);
    });

    await it('quotes a path with spaces in the one-liner, for the shell of that platform', async () => {
      const posix = serverSpec({
        allowWrite: false,
        install: {
          platform: 'darwin',
          launcher: '/Users/a b/Applications/Beifahrer.app/Contents/MacOS/beifahrer',
        },
      });
      expect(agent('claude-code').cli!(posix)).toBe(
        "claude mcp add --transport stdio beifahrer -- '/Users/a b/Applications/Beifahrer.app/Contents/MacOS/beifahrer' mcp",
      );
      const w = serverSpec({ allowWrite: false, install: { platform: 'win32', launcher: win } });
      expect(agent('claude-code').cli!(w)).toBe(
        'claude mcp add --transport stdio beifahrer -- "C:\\Program Files\\Beifahrer\\beifahrer.exe" mcp',
      );
      expect(shellQuote("it's", 'linux')).toBe("'it'\\''s'");
    });
  });

  await describe('commandInConfig', async () => {
    await it('reads the command back out of each shape', async () => {
      const s = serverSpec({ allowWrite: true, install: { platform: 'linux', flatpak: true } });
      for (const a of AGENTS) expect(commandInConfig(a, snippetOf(a, s))).toBe('flatpak');
    });

    await it('is null for a file that does not register Beifahrer or does not parse', async () => {
      expect(commandInConfig(agent('cursor'), '{"mcpServers":{}}')).toBe(null);
      expect(commandInConfig(agent('zed'), '{ // comment\n}')).toBe(null);
      expect(commandInConfig(agent('codex'), '[mcp_servers.other]\ncommand = "x"')).toBe(null);
    });
  });

  await describe('desktop AI apps', async () => {
    const platforms = ['linux', 'darwin', 'win32'];
    const files: Record<string, Record<string, string | null>> = {
      'lm-studio': {
        linux: '~/.lmstudio/mcp.json',
        darwin: '~/.lmstudio/mcp.json',
        win32: '%USERPROFILE%\\.lmstudio\\mcp.json',
      },
      anythingllm: {
        linux: '~/.config/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json',
        darwin:
          '~/Library/Application Support/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json',
        win32: '%APPDATA%\\anythingllm-desktop\\storage\\plugins\\anythingllm_mcp_servers.json',
      },
      jan: { linux: null, darwin: null, win32: null },
      goose: { linux: null, darwin: null, win32: null },
      'cherry-studio': { linux: null, darwin: null, win32: null },
      jetbrains: { linux: null, darwin: null, win32: null },
      other: { linux: null, darwin: null, win32: null },
    };

    await it('names the file only where the app docs did, per platform', async () => {
      for (const [id, byOs] of Object.entries(files))
        for (const os of platforms) expect(userConfigPath(agent(id), os)).toBe(byOs[os]!);
    });

    await it('gives every new entry the mcpServers snippet on every platform', async () => {
      for (const id of Object.keys(files)) {
        for (const os of platforms) {
          const s = serverSpec({ allowWrite: true, install: { platform: os } });
          expect(JSON.parse(snippetOf(agent(id), s))).toStrictEqual({
            mcpServers: { beifahrer: { command: 'beifahrer', args: ['mcp', '--allow-write'] } },
          });
        }
      }
    });

    await it('puts the Flatpak form in the snippet of the Other entry', async () => {
      const s = serverSpec({ allowWrite: false, install: { platform: 'linux', flatpak: true } });
      expect(JSON.parse(snippetOf(agent('other'), s))).toStrictEqual({
        mcpServers: { beifahrer: { command: 'flatpak', args: ['run', 'eu.jumplink.beifahrer', 'mcp'] } },
      });
    });

    await it('lists AI apps, then coding agents, then Other, and drops what a system cannot use', async () => {
      for (const os of platforms) {
        const groups = agentSections(os).map((s) => s.group);
        expect(groups.join()).toBe('apps,coding,other');
      }
      const linuxApps = agentSections('linux')[0]!.agents.map((a) => a.id);
      expect(linuxApps.includes('claude-desktop')).toBe(false);
      expect(linuxApps.includes('lm-studio')).toBe(true);
      expect(
        agentSections('darwin')[0]!
          .agents.map((a) => a.id)
          .includes('claude-desktop'),
      ).toBe(true);
      expect(
        agentSections('freebsd')[0]!
          .agents.map((a) => a.id)
          .join(),
      ).toBe('jan,goose,cherry-studio');
      expect(
        agentSections('linux')
          .at(-1)!
          .agents.map((a) => a.id)
          .join(),
      ).toBe('other');
    });

    await it('keeps an entry that has only a guide, and drops one with nothing at all', async () => {
      expect(supportsPlatform(agent('jan'), 'linux')).toBe(true);
      expect(supportsPlatform(agent('claude-desktop'), 'linux')).toBe(false);
      expect(supportsPlatform(agent('vscode'), 'linux')).toBe(true);
    });
  });
};
