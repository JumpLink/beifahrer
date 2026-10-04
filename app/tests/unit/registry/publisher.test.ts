import { describe, expect, it } from '@gjsify/unit';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryOf, STALE_MS, type BridgeStatus } from '@beifahrer/core';

import { publishRegistry } from '../../../src/registry/publisher.ts';
import { readEntries } from '../../../src/registry/store.ts';

/** The part of a bridge the publisher uses: a status that changes, and the three events. */
class FakeBridge extends EventEmitter {
  label = 'claude-code · werkstatt';
  browsers = 0;
  constructor(readonly instance = 'fake-1') {
    super();
  }
  status(): BridgeStatus {
    return {
      port: 47813,
      version: '0.1.4',
      session: { label: this.label, pid: 1, instance: this.instance, startedAt: '2026-10-04T11:00:00.000Z' },
      browsers: Array.from({ length: this.browsers }, (_, i) => ({
        id: `b${i}`,
        browser: { family: 'firefox' as const, name: 'Firefox', version: '155.0' },
        extension: { version: '0.1.4', manifestVersion: 3 as const },
        capabilities: [],
        connectedAt: '2026-10-04T11:05:00.000Z',
      })),
    };
  }
}

function withDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'beifahrer-publish-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NOW = new Date('2026-10-04T12:00:00.000Z');
// Long beat: the tests drive the writes by events, and a timer that fires mid-test would only blur it.
const OPTS = { heartbeatMs: 3_600_000, now: () => NOW };

export default async () => {
  await describe('publishRegistry', async () => {
    await it('announces the session at once', async () => {
      withDir((dir) => {
        const bridge = new FakeBridge();
        const pub = publishRegistry(bridge, { ...OPTS, dir });
        const { entries } = readEntries(dir);
        expect(entries.length).toBe(1);
        expect(entries[0]!.entry.label).toBe('claude-code · werkstatt');
        expect(entries[0]!.entry.updatedAt).toBe(NOW.toISOString());
        pub.stop();
      });
    });

    await it('follows a browser coming and going, and a rename', async () => {
      withDir((dir) => {
        const bridge = new FakeBridge();
        const pub = publishRegistry(bridge, { ...OPTS, dir });
        const now = () => readEntries(dir).entries[0]!.entry;

        bridge.browsers = 1;
        bridge.emit('connected');
        expect(now().browsers.length).toBe(1);

        bridge.browsers = 0;
        bridge.emit('disconnected');
        expect(now().browsers.length).toBe(0);

        bridge.label = 'cursor · werkstatt';
        bridge.emit('session');
        expect(now().label).toBe('cursor · werkstatt');
        pub.stop();
      });
    });

    await it('removes its entry on stop, stops writing, and may be stopped twice', async () => {
      withDir((dir) => {
        const bridge = new FakeBridge();
        const pub = publishRegistry(bridge, { ...OPTS, dir });
        pub.stop();
        pub.stop();
        expect(readEntries(dir).entries.length).toBe(0);
        bridge.emit('connected');
        expect(readEntries(dir).entries.length).toBe(0);
        expect(bridge.listenerCount('connected')).toBe(0);
      });
    });

    await it('sweeps a crashed bridge long dead, and leaves a recently dead one alone', async () => {
      withDir((dir) => {
        const old = (instance: string, agoMs: number) =>
          writeFileSync(
            join(dir, `${instance}.json`),
            JSON.stringify({
              ...entryOf({ ...new FakeBridge(instance).status() }, new Date(NOW.getTime() - agoMs)),
            }),
          );
        old('long-dead', STALE_MS + 120_000);
        old('just-dead', STALE_MS + 1_000);
        const pub = publishRegistry(new FakeBridge(), { ...OPTS, dir });
        expect(existsSync(join(dir, 'long-dead.json'))).toBe(false);
        expect(existsSync(join(dir, 'just-dead.json'))).toBe(true);
        pub.stop();
      });
    });

    await it('reports a failed write once and keeps going', async () => {
      withDir((dir) => {
        // A FILE where the directory should be: every write fails.
        const blocker = join(dir, 'blocked');
        writeFileSync(blocker, '');
        const errors: string[] = [];
        const bridge = new FakeBridge();
        const pub = publishRegistry(bridge, {
          ...OPTS,
          dir: blocker,
          onError: (e) => errors.push(e.message),
        });
        bridge.emit('connected');
        bridge.emit('session');
        expect(errors.length).toBe(1);
        pub.stop();
      });
    });
  });
};
