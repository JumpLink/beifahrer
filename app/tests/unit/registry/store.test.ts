import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryOf, type BridgeStatus } from '@beifahrer/core';

import { ensureDir, readEntries, removeEntry, writeEntry } from '@beifahrer/local';

const status = (instance: string): BridgeStatus => ({
  port: 47813,
  version: '0.1.4',
  session: { label: 'claude-code · werkstatt', pid: 1, instance, startedAt: '2026-10-04T11:00:00.000Z' },
  browsers: [],
});
const entry = (instance: string) => entryOf(status(instance), new Date('2026-10-04T12:00:00.000Z'));

function withDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'beifahrer-registry-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export default async () => {
  await describe('registry store', async () => {
    await it('writes an entry a reader gets back, and leaves no temp file behind', async () => {
      withDir((dir) => {
        writeEntry(dir, entry('aaaa-1'));
        expect(readdirSync(dir).join()).toBe('aaaa-1.json');
        const { entries, skipped } = readEntries(dir);
        expect(skipped).toBe(0);
        expect(entries.length).toBe(1);
        expect(entries[0]!.entry).toStrictEqual(entry('aaaa-1'));
      });
    });

    await it('writes the file readable by the owner only', async () => {
      withDir((dir) => {
        writeEntry(dir, entry('aaaa-1'));
        // Windows has no mode bits to read back; the check is for the platforms that have them.
        if (process.platform !== 'win32') expect(statSync(join(dir, 'aaaa-1.json')).mode & 0o077).toBe(0);
      });
    });

    await it('replaces an entry in place', async () => {
      withDir((dir) => {
        writeEntry(dir, entry('aaaa-1'));
        writeEntry(dir, { ...entry('aaaa-1'), label: 'renamed' });
        const { entries } = readEntries(dir);
        expect(entries.length).toBe(1);
        expect(entries[0]!.entry.label).toBe('renamed');
      });
    });

    await it('removes an entry, and removing a missing one is not an error', async () => {
      withDir((dir) => {
        writeEntry(dir, entry('aaaa-1'));
        removeEntry(dir, 'aaaa-1');
        removeEntry(dir, 'aaaa-1');
        expect(readEntries(dir).entries.length).toBe(0);
      });
    });

    await it('refuses an instance that is not a plain id, so it can never name another path', async () => {
      withDir((dir) => {
        expect(() => writeEntry(dir, entry('../escape'))).toThrow();
        expect(() => removeEntry(dir, '../escape')).toThrow();
        expect(existsSync(join(dir, '..', 'escape.json'))).toBe(false);
      });
    });

    await it('a missing directory is an empty registry', async () => {
      expect(readEntries(join(tmpdir(), 'beifahrer-registry-never-made'))).toStrictEqual({
        entries: [],
        skipped: 0,
      });
    });

    await it('counts what it cannot read instead of dropping it silently', async () => {
      withDir((dir) => {
        writeEntry(dir, entry('good-1'));
        writeFileSync(join(dir, 'broken.json'), '{ not json');
        writeFileSync(join(dir, 'wrong-v.json'), JSON.stringify({ ...entry('wrong-v'), v: 9 }));
        writeFileSync(join(dir, 'huge.json'), 'x'.repeat(70 * 1024));
        // Another session's entry under a name that is not its own would shadow it.
        writeFileSync(join(dir, 'liar-1.json'), JSON.stringify(entry('good-1')));
        // Neither of these is an entry file, and neither is counted.
        writeFileSync(join(dir, '.good-1.json.tmp'), '{');
        writeFileSync(join(dir, 'notes.txt'), 'hi');
        const { entries, skipped } = readEntries(dir);
        expect(entries.map((e) => e.entry.instance).join()).toBe('good-1');
        expect(skipped).toBe(4);
      });
    });

    await it('ensureDir creates the directory for its owner only', async () => {
      withDir((root) => {
        const dir = join(root, 'a', 'sessions');
        ensureDir(dir);
        if (process.platform !== 'win32') expect(statSync(dir).mode & 0o077).toBe(0);
      });
    });
  });
};
