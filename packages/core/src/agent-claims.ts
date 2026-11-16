/**
 * What the agent catalog (`agents.ts`) claims about each agent's docs page, and how to check a page
 * against it. Pure: the fetch lives in `tools/check-agent-catalog.mjs`, so the matching is tested
 * with fixture strings and never touches the network.
 *
 * A claim is a literal the page must still show (`mcpServers`, `[mcp_servers.`, ...). It is a grep,
 * not a parser: a docs site that renames the key fails it, one that re-words a paragraph does not.
 * An empty page, an error or an unreachable site is `unverified`, never `ok`: the check cannot say
 * the catalog is true, only that it could not look.
 */

import type { AgentEntry } from './agents.ts';

export interface Claim {
  /** What the catalog says, in words, for the report line. */
  what: string;
  /** Matched against the normalised page text; a string is a literal, not a pattern. */
  needle: string | RegExp;
}

const mcpServers: Claim = { what: 'the `mcpServers` key', needle: 'mcpServers' };

/**
 * Per agent id. An entry with no claim would be a silent pass, so `claimsOf` throws for an id that
 * is missing here and the test pins every `AGENTS` id.
 */
export const CLAIMS: Record<string, Claim[]> = {
  'claude-code': [
    mcpServers,
    { what: 'the `claude mcp add` command', needle: 'claude mcp add' },
    { what: 'the `--transport` flag', needle: '--transport' },
  ],
  opencode: [
    { what: 'the `mcp` key', needle: '"mcp"' },
    { what: 'a `"type": "local"` server', needle: /"type":\s*"local"/ },
  ],
  codex: [{ what: 'a `[mcp_servers.<name>]` table', needle: '[mcp_servers.' }],
  'gemini-cli': [mcpServers],
  cursor: [mcpServers],
  vscode: [
    { what: 'the `mcpServers` key', needle: /"mcpServers":\s*\{/ },
    { what: 'a `"type": "stdio"` server', needle: /"type":\s*"stdio"/ },
    { what: 'the user `mcp-config.json` file', needle: 'mcp-config.json' },
    { what: 'the workspace-root `.mcp.json` file', needle: '.mcp.json' },
  ],
  'claude-desktop': [
    mcpServers,
    { what: 'the `claude_desktop_config.json` file', needle: 'claude_desktop_config.json' },
  ],
  zed: [{ what: 'the `context_servers` key', needle: 'context_servers' }],
  'lm-studio': [mcpServers, { what: 'the `mcp.json` file', needle: 'mcp.json' }],
  anythingllm: [
    mcpServers,
    { what: 'the `anythingllm_mcp_servers.json` file', needle: 'anythingllm_mcp_servers.json' },
  ],
  jan: [{ what: 'a form that asks for a command', needle: /command/i }],
  goose: [{ what: 'an extension that asks for a command', needle: /command/i }],
  'cherry-studio': [{ what: 'MCP servers (the page is Chinese)', needle: 'MCP' }],
  jetbrains: [mcpServers],
  other: [mcpServers],
};

export function claimsOf(agent: Pick<AgentEntry, 'id'>): Claim[] {
  const claims = CLAIMS[agent.id];
  if (!claims || claims.length === 0) throw new Error(`no catalog claim for agent "${agent.id}"`);
  return claims;
}

const NAMED: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };

/**
 * Page text as a reader sees it: tags dropped (a syntax highlighter splits `"servers"` over spans),
 * entities decoded, JSON-escaped quotes (`\"`, pages that embed their content as data) undone, runs of
 * whitespace collapsed.
 */
export function normalizePage(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return NAMED[String(name).toLowerCase()] ?? all;
    })
    .replace(/\\"/g, '"')
    .replace(/\s+/g, ' ');
}

/** Below this the page is a shell, a consent wall or an error body, and says nothing about the claim. */
export const MIN_PAGE_CHARS = 200;

export type ClaimVerdict =
  | { status: 'ok'; checked: number }
  | { status: 'drifted'; missing: string[] }
  | { status: 'unverified'; reason: string };

/** What the fetch brought back: `status` 0 means no response at all (timeout, DNS, refused). */
export interface Fetched {
  status: number;
  body: string;
  error?: string;
}

export function verify(claims: readonly Claim[], fetched: Fetched): ClaimVerdict {
  if (fetched.status === 0) return { status: 'unverified', reason: fetched.error ?? 'no response' };
  if (fetched.status < 200 || fetched.status >= 300) {
    return { status: 'unverified', reason: `HTTP ${fetched.status}` };
  }
  const text = normalizePage(fetched.body);
  if (text.length < MIN_PAGE_CHARS) {
    return { status: 'unverified', reason: `page has ${text.length} readable characters` };
  }
  const missing = claims
    .filter((c) => (typeof c.needle === 'string' ? !text.includes(c.needle) : !c.needle.test(text)))
    .map((c) => c.what);
  return missing.length === 0 ? { status: 'ok', checked: claims.length } : { status: 'drifted', missing };
}

/** 0: every agent verified; 1: at least one drifted; 2: nothing drifted but something is unverified. */
export function claimsExitCode(verdicts: readonly ClaimVerdict[]): 0 | 1 | 2 {
  if (verdicts.some((v) => v.status === 'drifted')) return 1;
  return verdicts.some((v) => v.status === 'unverified') ? 2 : 0;
}
