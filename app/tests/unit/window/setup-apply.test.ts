import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { findAgent, serverSpec } from '@beifahrer/core';

import { applyConfigEdit, type ApplyRequest, type FileOps } from '../../../src/window/setup-apply.ts';
import { diskOps } from '../../../src/window/setup-fs.ts';

const agent = findAgent('cursor')!;
const server = serverSpec({ allowWrite: false });
const NOW = new Date('2026-11-02T10:20:30Z');
const FILE = '/cfg/mcp.json';
const OLD = '{\n  "mcpServers": {}\n}\n';

/** An in-memory disk that logs every call, so the ORDER of reads and writes can be pinned. */
function memory(files: Record<string, string> = {}) {
  const log: string[] = [];
  const ops: FileOps = {
    read: (p) => {
      log.push(`read ${p}`);
      return p in files ? files[p]! : null;
    },
    createNew: (p, text) => {
      log.push(`createNew ${p}`);
      if (p in files) throw new Error('exists');
      files[p] = text;
    },
    replace: (p, text) => {
      log.push(`replace ${p}`);
      files[p] = text;
    },
  };
  return { files, log, ops };
}

const request = (over: Partial<ApplyRequest> = {}): ApplyRequest => ({
  agent,
  file: FILE,
  server,
  shown: OLD,
  confirmed: true,
  now: NOW,
  ...over,
});

export default async () => {
  await describe('applyConfigEdit safety net', async () => {
    await it('does not read or write without a confirmation', async () => {
      const m = memory({ [FILE]: OLD });
      const result = applyConfigEdit(request({ confirmed: false }), m.ops);
      expect(result.status).toBe('not-confirmed');
      expect(m.log.length).toBe(0);
      expect(m.files[FILE]).toBe(OLD);
    });

    await it('has the backup, equal to the old file, before the original is replaced', async () => {
      const m = memory({ [FILE]: OLD });
      let backupAtReplace: string | undefined;
      const spy: FileOps = {
        ...m.ops,
        replace: (p, text) => {
          backupAtReplace = Object.entries(m.files).find(([k]) => k.includes('.beifahrer-backup-'))?.[1];
          m.ops.replace(p, text);
        },
      };
      const result = applyConfigEdit(request(), spy);
      expect(result.status).toBe('written');
      expect(backupAtReplace).toBe(OLD);
      const order = m.log.filter((l) => !l.startsWith('read'));
      expect(order[0]).toMatch(/^createNew .*\.beifahrer-backup-20261102T102030Z$/);
      expect(order[1]).toBe(`replace ${FILE}`);
      expect(m.files[FILE]).not.toBe(OLD);
      expect(JSON.parse(m.files[FILE]!).mcpServers.beifahrer.command).toBe('beifahrer');
    });

    await it('creates a missing file without a backup', async () => {
      const m = memory();
      const result = applyConfigEdit(request({ shown: null }), m.ops);
      expect(result).toStrictEqual({ status: 'written', backup: null });
      expect(m.log.some((l) => l.startsWith('createNew'))).toBe(false);
    });

    await it('does not rewrite a config that is already correct', async () => {
      const m = memory({ [FILE]: OLD });
      applyConfigEdit(request(), m.ops);
      const done = m.files[FILE]!;
      const again = memory({ [FILE]: done });
      const result = applyConfigEdit(request({ shown: done }), again.ops);
      expect(result.status).toBe('unchanged');
      expect(again.log.some((l) => l.startsWith('createNew') || l.startsWith('replace'))).toBe(false);
    });

    await it('never overwrites a file it cannot parse', async () => {
      const broken = '{ "mcpServers": ';
      const m = memory({ [FILE]: broken });
      const result = applyConfigEdit(request({ shown: broken }), m.ops);
      expect(result.status).toBe('unparseable');
      expect(m.files[FILE]).toBe(broken);
      expect(m.log.some((l) => l.startsWith('createNew') || l.startsWith('replace'))).toBe(false);
    });

    await it('stops when the file changed after the diff was shown', async () => {
      const m = memory({ [FILE]: '{ "other": 1 }\n' });
      const result = applyConfigEdit(request(), m.ops);
      expect(result.status).toBe('changed-meanwhile');
      expect(m.files[FILE]).toBe('{ "other": 1 }\n');
    });

    await it('does not touch the original when the backup fails', async () => {
      const m = memory({ [FILE]: OLD });
      const ops: FileOps = {
        ...m.ops,
        createNew: () => {
          throw new Error('disk full');
        },
      };
      const result = applyConfigEdit(request(), ops);
      expect(result.status).toBe('backup-failed');
      expect(m.files[FILE]).toBe(OLD);
    });

    await it('does not touch the original when the backup reads back differently', async () => {
      const m = memory({ [FILE]: OLD });
      const ops: FileOps = { ...m.ops, createNew: (p) => void (m.files[p] = 'truncated') };
      const result = applyConfigEdit(request(), ops);
      expect(result.status).toBe('backup-failed');
      expect(m.files[FILE]).toBe(OLD);
    });
  });

  await describe('applyConfigEdit on a real disk', async () => {
    await it('writes the file, keeps a backup of the old one and never reuses a backup name', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'beifahrer-setup-'));
      try {
        const file = join(dir, 'mcp.json');
        writeFileSync(file, OLD);
        const result = applyConfigEdit(request({ file }), diskOps);
        expect(result.status).toBe('written');
        const backups = readdirSync(dir).filter((n) => n.includes('.beifahrer-backup-'));
        expect(backups.length).toBe(1);
        expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe(OLD);
        expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.beifahrer.command).toBe('beifahrer');
        expect(readdirSync(dir).some((n) => n.includes('.beifahrer-tmp-'))).toBe(false);
        expect(() => diskOps.createNew(join(dir, backups[0]!), 'x')).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('creates the folder for a file that does not exist yet', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'beifahrer-setup-'));
      try {
        const file = join(dir, 'nested', 'mcp.json');
        const result = applyConfigEdit(request({ file, shown: null }), diskOps);
        expect(result.status).toBe('written');
        expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.beifahrer.command).toBe('beifahrer');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
};
