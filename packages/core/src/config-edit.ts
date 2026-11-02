/**
 * What changing an agent's config file to register Beifahrer would do, decided BEFORE anything is
 * written: the new text, the diff to show the person, and the path of the backup that has to exist
 * first (ADR 0023 § 2). Pure: it gets the file's text and returns a plan; the window's writer is the
 * only place that touches a disk, and it acts on this plan only after the person confirmed.
 *
 * The planner is conservative on purpose. It returns `unparseable` for anything it cannot rewrite
 * with certainty (JSON with comments, a TOML table written in a form it does not recognise, a
 * `mcpServers` that is not an object, numbers a JSON round trip would round), because the cost of a
 * wrong guess is a person's working agent setup and the cost of refusing is one paste.
 */

import { snippetOf, type AgentEntry, type ServerSpec } from './agents.ts';

export interface DiffLine {
  op: ' ' | '+' | '-' | '…';
  text: string;
}

export type EditPlan =
  /** No file yet: one is created with the whole snippet. */
  | { kind: 'create'; after: string; diff: DiffLine[] }
  /** The file exists and `beifahrer` is missing or different: only that entry changes. */
  | { kind: 'update'; before: string; after: string; diff: DiffLine[] }
  /** The file already registers exactly this server. Nothing is written. */
  | { kind: 'unchanged' }
  /** The file is there and cannot be rewritten safely. Nothing is written, ever. */
  | { kind: 'unparseable'; reason: 'syntax' | 'shape' | 'numbers' };

/** The entry each JSON shape holds under `beifahrer`. */
function jsonEntry(agent: AgentEntry, server: ServerSpec): Record<string, unknown> {
  const { command, args } = server;
  switch (agent.shape) {
    case 'opencode':
      return { type: 'local', command: [command, ...args] };
    case 'vscode':
      return { type: 'stdio', command, args };
    default:
      return { command, args };
  }
}

const JSON_KEY: Record<string, string> = {
  mcpServers: 'mcpServers',
  opencode: 'mcp',
  vscode: 'servers',
  zed: 'context_servers',
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function planConfigEdit(agent: AgentEntry, existing: string | null, server: ServerSpec): EditPlan {
  return agent.shape === 'codex' ? planToml(agent, existing, server) : planJson(agent, existing, server);
}

function finish(existing: string | null, after: string): EditPlan {
  if (existing === null) return { kind: 'create', after, diff: diffLines('', after) };
  return { kind: 'update', before: existing, after, diff: diffLines(existing, after) };
}

function planJson(agent: AgentEntry, existing: string | null, server: ServerSpec): EditPlan {
  if (existing === null) return finish(null, `${snippetOf(agent, server)}\n`);
  if (existing.trim() === '') return finish(existing, `${snippetOf(agent, server)}\n`);
  // A JSON round trip rounds integers beyond 2^53; refuse rather than rewrite someone's state file.
  if (/[:[,]\s*-?\d{16,}\s*[,\]}]/.test(existing)) return { kind: 'unparseable', reason: 'numbers' };
  let doc: unknown;
  try {
    doc = JSON.parse(existing);
  } catch {
    return { kind: 'unparseable', reason: 'syntax' };
  }
  if (!isObject(doc)) return { kind: 'unparseable', reason: 'shape' };
  const key = JSON_KEY[agent.shape]!;
  const container = doc[key];
  if (container !== undefined && !isObject(container)) return { kind: 'unparseable', reason: 'shape' };
  const desired = jsonEntry(agent, server);
  const current = container?.['beifahrer'];
  if (current !== undefined && !isObject(current)) return { kind: 'unparseable', reason: 'shape' };
  if (current && Object.keys(desired).every((k) => JSON.stringify(current[k]) === JSON.stringify(desired[k])))
    return { kind: 'unchanged' };
  // Keep what else the person put in the entry (an `env`), and its place among the other servers.
  const entry = { ...current, ...desired };
  const next = { ...doc, [key]: { ...container, beifahrer: entry } };
  const indent = /^([ \t]+)"/m.exec(existing)?.[1] ?? '  ';
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  // Edit the text where the entry is, so the other servers keep the way the person wrote them. The
  // result must parse to exactly what the whole-document path would give, or that path wins.
  const spliced = spliceJson(existing, key, entry, indent, eol);
  if (spliced !== null && sameJson(spliced, next)) return finish(existing, spliced);
  let after = JSON.stringify(next, null, indent);
  if (eol === '\r\n') after = after.replace(/\n/g, eol);
  if (/\r?\n$/.test(existing)) after += eol;
  return finish(existing, after);
}

function sameJson(text: string, expected: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

const skipSpace = (s: string, i: number): number => {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
};

/** The index after the string literal that opens at `i`. */
function skipString(s: string, i: number): number {
  i++;
  while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** The index after the JSON value that starts at `i`. The text already parsed, so it is well formed. */
function skipValue(s: string, i: number): number {
  const c = s[i];
  if (c === '"') return skipString(s, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (; i < s.length; i++) {
      const d = s[i]!;
      if (d === '"') i = skipString(s, i) - 1;
      else if (d === '{' || d === '[') depth++;
      else if ((d === '}' || d === ']') && --depth === 0) return i + 1;
    }
    return s.length;
  }
  while (i < s.length && !/[\s,\]}]/.test(s[i]!)) i++;
  return i;
}

interface Member {
  name: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

/** The members of the object that opens at `open`, with where each key and value sit in the text. */
function membersOf(s: string, open: number): Member[] {
  const members: Member[] = [];
  let i = skipSpace(s, open + 1);
  while (s[i] === '"') {
    const keyEnd = skipString(s, i);
    const name = JSON.parse(s.slice(i, keyEnd)) as string;
    const valueStart = skipSpace(s, skipSpace(s, keyEnd) + 1);
    const valueEnd = skipValue(s, valueStart);
    members.push({ name, keyStart: i, valueStart, valueEnd });
    i = skipSpace(s, valueEnd);
    if (s[i] === ',') i = skipSpace(s, i + 1);
  }
  return members;
}

/** The indent of the line `at` starts, or null when something else stands before it on that line. */
function lineIndent(s: string, at: number): string | null {
  const from = s.lastIndexOf('\n', at - 1) + 1;
  const before = s.slice(from, at);
  return /^[ \t]*$/.test(before) ? before : null;
}

/**
 * Puts `entry` under `key.beifahrer` by editing the text: replaces the value of an existing
 * `beifahrer`, or appends a member after the last one. Null whenever the layout is not the plain
 * one-member-per-line kind (an empty or one-line object), where the caller re-writes the document.
 */
function spliceJson(s: string, key: string, entry: unknown, unit: string, eol: string): string | null {
  try {
    const root = skipSpace(s, 0);
    if (s[root] !== '{') return null;
    const last = (members: Member[], name: string) => members.filter((m) => m.name === name).pop();
    const render = (value: unknown, indent: string) =>
      JSON.stringify(value, null, unit).replace(/\n/g, eol + indent);
    const append = (open: number, name: string, value: unknown): string | null => {
      const members = membersOf(s, open);
      const tail = members[members.length - 1];
      const indent = tail ? lineIndent(s, members[0]!.keyStart) : null;
      if (!tail || indent === null || lineIndent(s, tail.keyStart) === null) return null;
      return `${s.slice(0, tail.valueEnd)},${eol}${indent}${JSON.stringify(name)}: ${render(value, indent)}${s.slice(tail.valueEnd)}`;
    };
    const container = last(membersOf(s, root), key);
    if (!container) return append(root, key, { beifahrer: entry });
    if (s[container.valueStart] !== '{') return null;
    const own = last(membersOf(s, container.valueStart), 'beifahrer');
    if (!own) return append(container.valueStart, 'beifahrer', entry);
    const indent = lineIndent(s, own.keyStart);
    if (indent === null) return null;
    return s.slice(0, own.valueStart) + render(entry, indent) + s.slice(own.valueEnd);
  } catch {
    return null;
  }
}

/** A TOML basic or literal string at the start of `rest`, or undefined when it is neither. */
function tomlString(rest: string): string | undefined {
  const m = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(rest);
  if (!m) return undefined;
  if (m[2] !== undefined) return m[2];
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return undefined;
  }
}

function planToml(agent: AgentEntry, existing: string | null, server: ServerSpec): EditPlan {
  const snippet = snippetOf(agent, server);
  if (existing === null || existing.trim() === '') return finish(existing, `${snippet}\n`);
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing.split(/\r?\n/);
  const header = /^\s*\[mcp_servers\.beifahrer\]\s*(#.*)?$/;
  const mains = lines.flatMap((l, i) => (header.test(l) ? [i] : []));
  // Any other way of writing the same table would be duplicated by an append, which is invalid TOML.
  const elsewhere = lines.some(
    (l, i) =>
      !mains.includes(i) &&
      (/^\s*mcp_servers\s*=/.test(l) ||
        /^\s*mcp_servers\s*\.\s*["']?beifahrer/.test(l) ||
        /^\s*\[\[?\s*mcp_servers\s*\.\s*["']beifahrer/.test(l) ||
        /^\s*["']?beifahrer["']?\s*[.=]/.test(l)),
  );
  if (mains.length > 1 || elsewhere) return { kind: 'unparseable', reason: 'shape' };

  const [commandLine, argsLine] = snippet.split('\n').slice(1) as [string, string];
  const wantCommand = server.command;
  const wantArgs = JSON.stringify(server.args);

  if (mains.length === 0) {
    const out = [...lines];
    if (out[out.length - 1] === '') out.pop();
    if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('');
    out.push(...snippet.split('\n'));
    return finish(existing, `${out.join(eol)}${eol}`);
  }

  const start = mains[0]! + 1;
  let end = lines.findIndex((l, i) => i >= start && l.trimStart().startsWith('['));
  if (end < 0) end = lines.length;
  let commandAt = -1;
  let argsAt = -1;
  let commandOk = false;
  let argsOk = false;
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    const c = /^\s*command\s*=(.*)$/.exec(line);
    if (c) {
      const value = tomlString(c[1]!);
      if (value === undefined) return { kind: 'unparseable', reason: 'syntax' };
      commandAt = i;
      commandOk = value === wantCommand;
      continue;
    }
    const a = /^\s*args\s*=(.*)$/.exec(line);
    if (a) {
      const m = /^\s*(\[.*\])\s*(?:#.*)?$/.exec(a[1]!);
      if (!m) return { kind: 'unparseable', reason: 'syntax' };
      argsAt = i;
      try {
        argsOk = JSON.stringify(JSON.parse(m[1]!)) === wantArgs;
      } catch {
        argsOk = false;
      }
    }
  }
  if (commandAt >= 0 && argsAt >= 0 && commandOk && argsOk) return { kind: 'unchanged' };

  const out = [...lines];
  // Replace in place from the bottom up, so the earlier index stays valid.
  const edits: [number, string][] = [];
  if (argsAt >= 0) edits.push([argsAt, argsLine]);
  if (commandAt >= 0) edits.push([commandAt, commandLine]);
  edits.sort((x, y) => y[0] - x[0]);
  for (const [at, text] of edits) out[at] = text;
  const inserts: string[] = [];
  if (commandAt < 0) inserts.push(commandLine);
  if (argsAt < 0) inserts.push(argsLine);
  if (inserts.length > 0)
    out.splice(commandAt >= 0 ? commandAt + 1 : argsAt >= 0 ? argsAt : start, 0, ...inserts);
  return finish(existing, out.join(eol));
}

/**
 * A line diff with three lines of context, for the one region that changed. The common head and tail
 * are cut off first, so the quadratic part only sees the lines that differ: a config with thousands
 * of lines and one new entry costs a handful of comparisons.
 */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: DiffLine[] = [];
  const from = Math.max(0, head - context);
  if (from > 0) out.push({ op: '…', text: '' });
  for (const text of a.slice(from, head)) out.push({ op: ' ', text });
  out.push(...middle(midA, midB));
  const tailStart = a.length - tail;
  for (const text of a.slice(tailStart, tailStart + context)) out.push({ op: ' ', text });
  if (tail > context) out.push({ op: '…', text: '' });
  return out;
}

function middle(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > 1_000_000) {
    return [
      ...a.map((text): DiffLine => ({ op: '-', text })),
      ...b.map((text): DiffLine => ({ op: '+', text })),
    ];
  }
  // Longest common subsequence table, walked from the front.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ op: '-', text: a[i++]! });
    else out.push({ op: '+', text: b[j++]! });
  }
  while (i < n) out.push({ op: '-', text: a[i++]! });
  while (j < m) out.push({ op: '+', text: b[j++]! });
  return out;
}

/** The diff as the plain text a person reads: one line per entry, `+`, `-` or two spaces in front. */
export function renderDiff(lines: readonly DiffLine[]): string {
  return lines.map((l) => (l.op === '…' ? '…' : `${l.op === ' ' ? ' ' : l.op} ${l.text}`)).join('\n');
}

/**
 * Where the old file is copied before it is replaced: beside it, named after the moment, in UTC so two
 * runs a second apart cannot collide on a clock change. The suffix is ASCII and path separator free,
 * so it is valid on every platform the file is.
 */
export function backupPathOf(file: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `${file}.beifahrer-backup-${stamp}`;
}
