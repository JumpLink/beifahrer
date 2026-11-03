/**
 * How to register Beifahrer's MCP server with each coding agent: one table, read by `beifahrer config`
 * and by the desktop window's "Connect an agent" page, so the two cannot say different things.
 *
 * Pure: the snippet is text and the path is a string with `~` in it. Nothing here reads or writes an
 * agent's config; the person pastes it, or the setup assistant writes it through `config-edit.ts` (ADR 0017, 0023). Each entry was read from the agent's own docs on
 * the date in `CHECKED`, and a field the docs did not settle is `null` rather than a guess: the
 * window then says "see the docs" instead of a path that may be wrong. Formats change, so
 * `docs` is the link a person follows when the snippet no longer works.
 */

export const CHECKED = '2026-11-03';

/** The Flatpak app id of the one package (`gjsify.ship.appId`): `flatpak run <id> mcp` is the bridge. */
export const FLATPAK_ID = 'eu.jumplink.beifahrer';

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

/** `apps`: desktop AI apps; `coding`: coding agents and editors; `other`: the one entry for any app not listed. */
export type AgentGroup = 'apps' | 'coding' | 'other';

/**
 * How a person registers the server in an app with no file we may write: `fields` = type command and
 * arguments into a form; `json` = paste the `mcpServers` JSON into a box.
 */
export type GuideKind = 'fields' | 'json';

export interface AgentEntry {
  id: string;
  name: string;
  /** For a `fields` guide the shape is not shown: only command and arguments are. */
  shape: Shape;
  group: AgentGroup;
  /** Set where the app is set up in its own settings screens, not by a file: the window shows steps. */
  guide: GuideKind | null;
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
    group: 'coding',
    guide: null,
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
    group: 'coding',
    guide: null,
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
    group: 'coding',
    guide: null,
    docs: 'https://developers.openai.com/codex/mcp',
    user: HOME_ALL('~/.codex/config.toml'),
    project: '.codex/config.toml',
    cli: null,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    shape: 'mcpServers',
    group: 'coding',
    guide: null,
    docs: 'https://geminicli.com/docs/tools/mcp-server/',
    user: HOME_ALL('~/.gemini/settings.json'),
    project: '.gemini/settings.json',
    cli: null,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    shape: 'mcpServers',
    group: 'coding',
    guide: null,
    docs: 'https://cursor.com/docs/mcp',
    user: HOME_ALL('~/.cursor/mcp.json'),
    project: '.cursor/mcp.json',
    cli: null,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    shape: 'vscode',
    group: 'coding',
    guide: null,
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
    group: 'apps',
    guide: null,
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
    group: 'coding',
    guide: null,
    docs: 'https://zed.dev/docs/ai/mcp',
    user: { linux: '~/.config/zed/settings.json', darwin: '~/.config/zed/settings.json', win32: null },
    project: null,
    cli: null,
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    shape: 'mcpServers',
    group: 'apps',
    guide: null,
    docs: 'https://lmstudio.ai/docs/app/mcp',
    // The file's place is in LM Studio's 0.3.17 release notes; its docs only say "Edit mcp.json".
    user: {
      linux: '~/.lmstudio/mcp.json',
      darwin: '~/.lmstudio/mcp.json',
      win32: '%USERPROFILE%\\.lmstudio\\mcp.json',
    },
    project: null,
    cli: null,
  },
  {
    id: 'anythingllm',
    name: 'AnythingLLM',
    shape: 'mcpServers',
    group: 'apps',
    guide: null,
    docs: 'https://docs.anythingllm.com/mcp-compatibility/desktop',
    user: {
      linux: '~/.config/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json',
      darwin:
        '~/Library/Application Support/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json',
      win32: '%APPDATA%\\anythingllm-desktop\\storage\\plugins\\anythingllm_mcp_servers.json',
    },
    project: null,
    cli: null,
  },
  {
    id: 'jan',
    name: 'Jan',
    shape: 'mcpServers',
    group: 'apps',
    guide: 'fields',
    docs: 'https://www.jan.ai/docs/desktop/mcp',
    user: { linux: null, darwin: null, win32: null },
    project: null,
    cli: null,
  },
  {
    id: 'goose',
    name: 'Goose',
    shape: 'mcpServers',
    group: 'apps',
    guide: 'fields',
    // Goose keeps its extensions in a YAML file, which the window does not edit.
    docs: 'https://goose-docs.ai/docs/getting-started/using-extensions',
    user: { linux: null, darwin: null, win32: null },
    project: null,
    cli: null,
  },
  {
    id: 'cherry-studio',
    name: 'Cherry Studio',
    shape: 'mcpServers',
    group: 'apps',
    guide: 'fields',
    docs: 'https://docs.cherryai.com.cn/advanced-basic/extensions/mcp.md',
    user: { linux: null, darwin: null, win32: null },
    project: null,
    cli: null,
  },
  {
    id: 'jetbrains',
    name: 'JetBrains AI Assistant',
    shape: 'mcpServers',
    group: 'coding',
    guide: 'json',
    docs: 'https://www.jetbrains.com/help/ai-assistant/mcp.html',
    user: { linux: null, darwin: null, win32: null },
    project: null,
    cli: null,
  },
  {
    id: 'other',
    name: 'Other',
    shape: 'mcpServers',
    group: 'other',
    guide: 'json',
    docs: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
    user: { linux: null, darwin: null, win32: null },
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

export const GROUP_ORDER: readonly AgentGroup[] = ['apps', 'coding', 'other'];

/**
 * Whether the window has something to offer for `agent` on `platform`: a user file, a project file to
 * point at, or steps in the app's own settings. An entry with none of the three would be an empty page
 * ("see the docs"), so it is left out of the lists on that system instead of shown as a dead end.
 */
export function supportsPlatform(agent: AgentEntry, platform: string): boolean {
  return userConfigPath(agent, platform) !== null || agent.project !== null || agent.guide !== null;
}

export interface AgentSection {
  group: AgentGroup;
  agents: AgentEntry[];
}

/** The entries `platform` can use, in the groups AI apps, coding agents, other, with empty groups left out. */
export function agentSections(platform: string, agents: readonly AgentEntry[] = AGENTS): AgentSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    agents: agents.filter((a) => a.group === group && supportsPlatform(a, platform)),
  })).filter((s) => s.agents.length > 0);
}
