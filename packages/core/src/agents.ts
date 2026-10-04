/**
 * How to register Beifahrer's MCP server with each coding agent: one table, read by `beifahrer config`
 * and by the desktop window's "Connect an agent" page, so the two cannot say different things.
 *
 * Pure: the snippet is text and the path is a string with `~` in it. Nothing here reads or writes an
 * agent's config; the person pastes it (ADR 0017). Each entry was read from the agent's own docs on
 * the date in `CHECKED`, and a field the docs did not settle is `null` rather than a guess: the
 * window then says "see the docs" instead of a path that may be wrong. Formats change, so
 * `docs` is the link a person follows when the snippet no longer works.
 */

export const CHECKED = '2026-10-04';

/** The server every snippet registers. `command` is the installed `beifahrer` (README, Install). */
export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
}

export function serverSpec(opts: { allowWrite: boolean }): ServerSpec {
  return {
    name: 'beifahrer',
    command: 'beifahrer',
    args: opts.allowWrite ? ['mcp', '--allow-write'] : ['mcp'],
  };
}

export type Platform = 'linux' | 'darwin' | 'win32';

type Shape =
  /** `{"mcpServers": {name: {command, args}}}` */
  | 'mcpServers'
  /** `{"mcp": {name: {type: "local", command: [...]}}}` */
  | 'opencode'
  /** `[mcp_servers.name]` in TOML */
  | 'codex'
  /** `{"servers": {name: {type: "stdio", command, args}}}` */
  | 'vscode'
  /** `{"context_servers": {name: {command, args}}}` */
  | 'zed';

export interface AgentEntry {
  id: string;
  name: string;
  shape: Shape;
  /** The agent's own page about MCP servers. */
  docs: string;
  /** The user-level config file per platform; null where the docs did not name one. */
  user: Record<Platform, string | null>;
  /** The per-project config file, relative to the project, or null. */
  project: string | null;
  /** A one-line command that adds the server, where the agent has a non-interactive one. */
  cli: ((server: ServerSpec) => string) | null;
}

const HOME_ALL = (path: string): Record<Platform, string | null> => ({
  linux: path,
  darwin: path,
  win32: path,
});

export const AGENTS: readonly AgentEntry[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    shape: 'mcpServers',
    docs: 'https://code.claude.com/docs/en/mcp',
    user: HOME_ALL('~/.claude.json'),
    project: '.mcp.json',
    cli: (s) => `claude mcp add --transport stdio ${s.name} -- ${[s.command, ...s.args].join(' ')}`,
  },
  {
    id: 'opencode',
    name: 'opencode',
    shape: 'opencode',
    docs: 'https://opencode.ai/docs/mcp-servers/',
    user: {
      linux: '~/.config/opencode/opencode.json',
      darwin: '~/.config/opencode/opencode.json',
      win32: null,
    },
    project: 'opencode.json',
    cli: null,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    shape: 'codex',
    docs: 'https://developers.openai.com/codex/mcp',
    user: HOME_ALL('~/.codex/config.toml'),
    project: '.codex/config.toml',
    cli: null,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    shape: 'mcpServers',
    docs: 'https://geminicli.com/docs/tools/mcp-server/',
    user: HOME_ALL('~/.gemini/settings.json'),
    project: '.gemini/settings.json',
    cli: null,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    shape: 'mcpServers',
    docs: 'https://cursor.com/docs/mcp',
    user: HOME_ALL('~/.cursor/mcp.json'),
    project: '.cursor/mcp.json',
    cli: null,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    shape: 'vscode',
    docs: 'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
    // The user-level file is opened by the "MCP: Open User Configuration" command, not by a path the docs fix.
    user: { linux: null, darwin: null, win32: null },
    project: '.vscode/mcp.json',
    cli: null,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    shape: 'mcpServers',
    docs: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
    user: {
      linux: null,
      darwin: '~/Library/Application Support/Claude/claude_desktop_config.json',
      win32: '%APPDATA%\\Claude\\claude_desktop_config.json',
    },
    project: null,
    cli: null,
  },
  {
    id: 'zed',
    name: 'Zed',
    shape: 'zed',
    docs: 'https://zed.dev/docs/ai/mcp',
    user: { linux: '~/.config/zed/settings.json', darwin: '~/.config/zed/settings.json', win32: null },
    project: null,
    cli: null,
  },
];

export function findAgent(id: string): AgentEntry | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** What goes in the agent's config. JSON for every agent but Codex, which uses TOML. */
export function snippetOf(agent: AgentEntry, server: ServerSpec): string {
  const { name, command, args } = server;
  switch (agent.shape) {
    case 'mcpServers':
      return json({ mcpServers: { [name]: { command, args } } });
    case 'opencode':
      return json({
        $schema: 'https://opencode.ai/config.json',
        mcp: { [name]: { type: 'local', command: [command, ...args] } },
      });
    case 'vscode':
      return json({ servers: { [name]: { type: 'stdio', command, args } } });
    case 'zed':
      return json({ context_servers: { [name]: { command, args } } });
    case 'codex':
      // A JSON string is a valid TOML basic string for the plain words these are.
      return [
        `[mcp_servers.${name}]`,
        `command = ${JSON.stringify(command)}`,
        `args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`,
      ].join('\n');
  }
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The file to put it in on `platform`, or null when the agent's docs do not name one. */
export function userConfigPath(agent: AgentEntry, platform: string): string | null {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32' ? agent.user[platform] : null;
}
