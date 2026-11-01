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

/** The Flatpak app id of the bridge (`app/package.json`, `gjsify.ship.appId`). */
export const FLATPAK_ID = 'eu.jumplink.beifahrer.Cli';

/** Where the bridge lives on this host, as far as the caller could tell. */
export interface Install {
  platform: string;
  /** Running inside a Flatpak sandbox: the bridge is then reached through `flatpak run`. */
  flatpak?: boolean;
  /**
   * Absolute path of the bridge's launcher. `undefined`: not looked for (a checkout, deb/rpm, tests);
   * `null`: looked in the known places and found none.
   */
  launcher?: string | null;
}

/**
 * The launcher next to a process's executable, or undefined when the path is not one of an installed
 * bridge. The running executable is the bundled node, not the launcher: `Contents/Helpers/Beifahrer`
 * in the .app, `node.exe` in the program directory (gjsify `ship` layout). The caller still checks that
 * the file exists: a node from `C:\Program Files\nodejs` has the same shape.
 */
export function launcherOf(platform: string, execPath: string | null | undefined): string | undefined {
  if (!execPath) return undefined;
  if (platform === 'darwin') {
    const m = /^(.*\.app)\/Contents\/(?:MacOS|Helpers)\/[^/]+$/.exec(execPath);
    return m ? `${m[1]}/Contents/MacOS/beifahrer` : undefined;
  }
  if (platform === 'win32') {
    const m = /^(.*)[\\/](?:node|beifahrer)\.exe$/i.exec(execPath);
    return m ? `${m[1]}\\beifahrer.exe` : undefined;
  }
  return undefined;
}

/** The server every snippet registers. `command` is what starts the bridge on THIS host. */
export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
  /** The platform the command is for, which decides how a one-liner quotes it. */
  platform: string;
}

export function serverSpec(opts: { allowWrite: boolean; install?: Install }): ServerSpec {
  const mcp = opts.allowWrite ? ['mcp', '--allow-write'] : ['mcp'];
  const install = opts.install;
  const platform = install?.platform ?? 'linux';
  if (install?.flatpak) {
    return { name: 'beifahrer', command: 'flatpak', args: ['run', FLATPAK_ID, ...mcp], platform };
  }
  // deb/rpm put `beifahrer` on PATH; a checkout or an unknown host keeps that too.
  return { name: 'beifahrer', command: install?.launcher ?? 'beifahrer', args: mcp, platform };
}

/** One word of a shell command line, quoted for `platform`'s shell (POSIX sh, or cmd/PowerShell). */
export function shellQuote(word: string, platform: string): string {
  if (platform === 'win32') {
    return word === '' || /[\s"&|<>^%()]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word;
  }
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
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
    cli: (s) =>
      `claude mcp add --transport stdio ${s.name} -- ${[s.command, ...s.args].map((w) => shellQuote(w, s.platform)).join(' ')}`,
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

/**
 * The command a config file starts Beifahrer with, or null when the file does not register it or is
 * not plain JSON/TOML (Zed's settings may carry comments; a file that does not parse is left alone).
 */
export function commandInConfig(agent: AgentEntry, text: string): string | null {
  if (agent.shape === 'codex') {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() === '[mcp_servers.beifahrer]');
    if (at < 0) return null;
    for (const line of lines.slice(at + 1)) {
      if (line.trimStart().startsWith('[')) break;
      const m = /^\s*command\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line);
      if (!m) continue;
      if (m[2] !== undefined) return m[2];
      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return null;
      }
    }
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const key = { mcpServers: 'mcpServers', opencode: 'mcp', vscode: 'servers', zed: 'context_servers' }[
    agent.shape
  ];
  const entry = ((doc as Record<string, unknown> | null)?.[key] as Record<string, unknown> | undefined)?.[
    'beifahrer'
  ] as { command?: unknown } | undefined;
  const command = entry?.command;
  if (typeof command === 'string') return command;
  if (Array.isArray(command) && typeof command[0] === 'string') return command[0];
  return null;
}
