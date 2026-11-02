import { describe, expect, it } from '@gjsify/unit';
import {
  backupPathOf,
  commandInConfig,
  diffLines,
  findAgent,
  planConfigEdit,
  renderDiff,
  serverSpec,
} from '@beifahrer/core';

const server = serverSpec({ allowWrite: false });
const agent = (id: string) => findAgent(id)!;

/** The text a plan would write, or a failure naming what it was instead. */
const after = (id: string, existing: string | null) => {
  const plan = planConfigEdit(agent(id), existing, server);
  if (plan.kind !== 'create' && plan.kind !== 'update') throw new Error(`plan was ${plan.kind}`);
  return plan.after;
};

export default async () => {
  await describe('planConfigEdit (JSON agents)', async () => {
    await it('creates a missing file from the snippet', async () => {
      const plan = planConfigEdit(agent('cursor'), null, server);
      expect(plan.kind).toBe('create');
      expect(commandInConfig(agent('cursor'), after('cursor', null))).toBe('beifahrer');
    });

    await it('adds the entry and keeps everything else, in the same layout', async () => {
      const before = '{\n\t"theme": "dark",\n\t"mcpServers": {\n\t\t"other": { "command": "x" }\n\t}\n}\n';
      const text = after('cursor', before);
      const doc = JSON.parse(text);
      expect(doc.theme).toBe('dark');
      expect(doc.mcpServers.other.command).toBe('x');
      expect(doc.mcpServers.beifahrer).toStrictEqual({ command: 'beifahrer', args: ['mcp'] });
      expect(text.startsWith('{\n\t"theme"')).toBe(true);
      expect(text.endsWith('}\n')).toBe(true);
    });

    await it('leaves the other servers exactly as written, compact ones included', async () => {
      const before =
        '{\n  "mcpServers": {\n    "other": { "command": "other-tool" }, \n    "second": {"command":"y"}\n  },\n  "n": 1\n}\n';
      const text = after('cursor', before);
      expect(
        text.startsWith(
          '{\n  "mcpServers": {\n    "other": { "command": "other-tool" }, \n    "second": {"command":"y"},\n    "beifahrer": {',
        ),
      ).toBe(true);
      expect(text.endsWith('\n  },\n  "n": 1\n}\n')).toBe(true);
      expect(JSON.parse(text).mcpServers.beifahrer).toStrictEqual({ command: 'beifahrer', args: ['mcp'] });
      const plan = planConfigEdit(agent('cursor'), before, server);
      if (plan.kind !== 'update') throw new Error(plan.kind);
      // Only the line that gains a comma changes; the compact `other` is not shown as removed.
      expect(plan.diff.filter((l) => l.op === '-').map((l) => l.text)).toStrictEqual([
        '    "second": {"command":"y"}',
      ]);
    });

    await it('replaces a stale entry in place and leaves its neighbours alone', async () => {
      const before =
        '{\r\n  "mcpServers": {\r\n    "a": {"command":"a"},\r\n    "beifahrer": { "command": "/old" },\r\n    "z": {"command":"z"}\r\n  }\r\n}\r\n';
      const text = after('cursor', before);
      expect(text.includes('    "a": {"command":"a"},\r\n')).toBe(true);
      expect(text.includes('    "z": {"command":"z"}\r\n  }\r\n}\r\n')).toBe(true);
      expect(text.includes('\r\n') && !/[^\r]\n/.test(text)).toBe(true);
      expect(JSON.parse(text).mcpServers.beifahrer.command).toBe('beifahrer');
    });

    await it('adds the whole container to a file that has none, below the other keys', async () => {
      const before = '{\n  "theme": {"a": [1,2]}\n}\n';
      const text = after('cursor', before);
      expect(text.startsWith('{\n  "theme": {"a": [1,2]},\n  "mcpServers": {')).toBe(true);
      expect(JSON.parse(text).mcpServers.beifahrer.command).toBe('beifahrer');
    });

    await it('falls back to a whole-document write for a one-line file', async () => {
      const text = after('cursor', '{"mcpServers":{"other":{"command":"x"}}}');
      expect(JSON.parse(text).mcpServers.other.command).toBe('x');
      expect(JSON.parse(text).mcpServers.beifahrer.command).toBe('beifahrer');
    });

    await it('changes only the stale entry and keeps what the person added to it', async () => {
      const before = JSON.stringify({
        mcpServers: { beifahrer: { command: '/old/path', args: ['mcp'], env: { A: '1' } } },
      });
      const doc = JSON.parse(after('gemini-cli', before));
      expect(doc.mcpServers.beifahrer).toStrictEqual({
        command: 'beifahrer',
        args: ['mcp'],
        env: { A: '1' },
      });
    });

    await it('is unchanged when the entry is already right, whatever the layout', async () => {
      const text = '{"mcpServers":{"beifahrer":{"command":"beifahrer","args":["mcp"]}}}';
      expect(planConfigEdit(agent('cursor'), text, server).kind).toBe('unchanged');
      expect(
        planConfigEdit(
          agent('opencode'),
          '{"mcp":{"beifahrer":{"type":"local","command":["beifahrer","mcp"]}}}',
          server,
        ).kind,
      ).toBe('unchanged');
      expect(
        planConfigEdit(
          agent('vscode'),
          '{"servers":{"beifahrer":{"type":"stdio","command":"beifahrer","args":["mcp"]}}}',
          server,
        ).kind,
      ).toBe('unchanged');
    });

    await it('writes the second run as unchanged: planning its own output finds nothing to do', async () => {
      for (const a of ['claude-code', 'opencode', 'vscode', 'zed', 'codex']) {
        const first = after(a, '{"keep":1}'.replace(/.*/, a === 'codex' ? 'model = "x"\n' : '{"keep":1}'));
        expect(planConfigEdit(agent(a), first, server).kind).toBe('unchanged');
      }
    });

    await it('refuses what it cannot rewrite with certainty', async () => {
      const refused = (id: string, text: string) => {
        const plan = planConfigEdit(agent(id), text, server);
        return plan.kind === 'unparseable' ? plan.reason : plan.kind;
      };
      expect(refused('zed', '// my settings\n{ "theme": "x" }')).toBe('syntax');
      expect(refused('cursor', '{ "mcpServers": ')).toBe('syntax');
      expect(refused('cursor', '[1, 2]')).toBe('shape');
      expect(refused('cursor', '{"mcpServers": []}')).toBe('shape');
      expect(refused('cursor', '{"mcpServers": {"beifahrer": "x"}}')).toBe('shape');
      expect(refused('claude-code', '{"id": 1234567890123456789}')).toBe('numbers');
    });

    await it('treats an empty file as an empty document', async () => {
      expect(planConfigEdit(agent('cursor'), '  \n', server).kind).toBe('update');
    });
  });

  await describe('planConfigEdit (Codex TOML)', async () => {
    await it('appends the table after a blank line and leaves the rest as it was', async () => {
      const text = after('codex', 'model = "x"\n[tools]\nweb = true\n');
      expect(text).toBe(
        'model = "x"\n[tools]\nweb = true\n\n[mcp_servers.beifahrer]\ncommand = "beifahrer"\nargs = ["mcp"]\n',
      );
    });

    await it('replaces a stale command and args inside the table only', async () => {
      const before =
        '[mcp_servers.beifahrer]\ncommand = "/old"\nargs = ["mcp", "--allow-write"]\nenv = { A = "1" }\n\n[other]\ncommand = "keep"\n';
      expect(after('codex', before)).toBe(
        '[mcp_servers.beifahrer]\ncommand = "beifahrer"\nargs = ["mcp"]\nenv = { A = "1" }\n\n[other]\ncommand = "keep"\n',
      );
    });

    await it('inserts a missing line and keeps CRLF', async () => {
      const text = after('codex', '[mcp_servers.beifahrer]\r\ncommand = "beifahrer"\r\n');
      expect(text).toBe('[mcp_servers.beifahrer]\r\ncommand = "beifahrer"\r\nargs = ["mcp"]\r\n');
    });

    await it('is unchanged when right, and refuses a table written another way', async () => {
      const right = '[mcp_servers.beifahrer]\ncommand = \'beifahrer\'\nargs = [ "mcp" ] # ok\n';
      expect(planConfigEdit(agent('codex'), right, server).kind).toBe('unchanged');
      for (const text of [
        '[mcp_servers."beifahrer"]\ncommand = "x"\n',
        'mcp_servers = { beifahrer = { command = "x" } }\n',
        '[mcp_servers]\nbeifahrer = { command = "x" }\n',
        '[mcp_servers.beifahrer]\n[mcp_servers.beifahrer]\n',
        '[mcp_servers.beifahrer]\ncommand = "x"\nargs = [\n  "mcp",\n]\n',
      ]) {
        expect(planConfigEdit(agent('codex'), text, server).kind).toBe('unparseable');
      }
    });
  });

  await describe('diffLines', async () => {
    await it('shows only the changed region with three lines of context', async () => {
      const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
      const changed = before.replace('line 10', 'LINE TEN');
      const text = renderDiff(diffLines(before, changed));
      expect(text).toBe(
        [
          '…',
          '  line 7',
          '  line 8',
          '  line 9',
          '- line 10',
          '+ LINE TEN',
          '  line 11',
          '  line 12',
          '  line 13',
          '…',
        ].join('\n'),
      );
    });

    await it('marks a new file as all additions', async () => {
      expect(renderDiff(diffLines('', 'a\nb'))).toBe('+ a\n+ b');
    });

    await it('marks inserted lines as additions and nothing else', async () => {
      const lines = diffLines('{\n}\n', '{\n  "a": 1\n}\n');
      expect(lines.filter((l) => l.op === '+').map((l) => l.text)).toStrictEqual(['  "a": 1']);
      expect(lines.some((l) => l.op === '-')).toBe(false);
    });
  });

  await describe('backupPathOf', async () => {
    await it('sits beside the file and carries the moment in UTC', async () => {
      const at = new Date('2026-11-02T10:15:30.123Z');
      expect(backupPathOf('/home/p/.claude.json', at)).toBe(
        '/home/p/.claude.json.beifahrer-backup-20261102T101530Z',
      );
      expect(backupPathOf('C:\\Users\\p\\x.json', at)).toBe(
        'C:\\Users\\p\\x.json.beifahrer-backup-20261102T101530Z',
      );
    });
  });
};
