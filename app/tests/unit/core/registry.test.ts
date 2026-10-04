import { describe, expect, it } from '@gjsify/unit';

import {
  HEARTBEAT_MS,
  STALE_MS,
  entryOf,
  isAlive,
  parseRegistryEntry,
  statusOf,
  sweepable,
  unregisteredPorts,
  type BridgeStatus,
  type RegistryEntry,
} from '@beifahrer/core';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const status: BridgeStatus = {
  port: 47813,
  version: '0.1.4',
  session: {
    label: 'claude-code · werkstatt',
    pid: 4242,
    instance: 'inst-1',
    startedAt: '2026-10-04T11:00:00.000Z',
  },
  browsers: [
    {
      id: 'e12cd41c',
      browser: { family: 'firefox', name: 'Firefox', version: '155.0' },
      extension: { version: '0.1.4', manifestVersion: 3 },
      capabilities: ['tabs.list'],
      unsupported: { 'page.screenshot': 'not on this browser' },
      connectedAt: '2026-10-04T11:05:00.000Z',
    },
  ],
};

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  ...entryOf(status, NOW),
  ...over,
});

// The registry is what a window, a tray icon and `beifahrer status` read (ADR 0015). It is a
// contract between processes, so what goes in, what comes out and when an entry counts as gone
// are all decided here, with no file and no clock.
export default async () => {
  await describe('entryOf', async () => {
    await it('carries the session and its browsers, and nothing an agent is not told', async () => {
      const e = entryOf(status, NOW);
      expect(e.instance).toBe('inst-1');
      expect(e.label).toBe('claude-code · werkstatt');
      expect(e.port).toBe(47813);
      expect(e.updatedAt).toBe(NOW.toISOString());
      expect(e.browsers).toStrictEqual([
        {
          id: 'e12cd41c',
          family: 'firefox',
          name: 'Firefox',
          version: '155.0',
          extensionVersion: '0.1.4',
          connectedAt: '2026-10-04T11:05:00.000Z',
        },
      ]);
      // The method list and the reasons are the agent's business, not a status reader's.
      expect(JSON.stringify(e)).not.toMatch(/capabilities|unsupported|screenshot|token/);
    });
  });

  await describe('parseRegistryEntry', async () => {
    await it('round-trips what entryOf writes', async () => {
      const e = entryOf(status, NOW);
      expect(parseRegistryEntry(JSON.parse(JSON.stringify(e)))).toStrictEqual(e);
    });

    await it('refuses what is not an entry, whole, instead of repairing it', async () => {
      const good = entryOf(status, NOW);
      const bad: unknown[] = [
        null,
        'x',
        42,
        { ...good, v: 2 },
        { ...good, v: undefined },
        { ...good, instance: '' },
        { ...good, label: 7 },
        { ...good, pid: -1 },
        { ...good, port: 1.5 },
        { ...good, updatedAt: 'yesterday' },
        { ...good, browsers: 'one' },
        { ...good, browsers: [{ id: 'x' }] },
      ];
      for (const raw of bad) expect(typeof parseRegistryEntry(raw)).toBe('string');
    });

    await it('copies only the known fields, so a file that carries more says nothing more', async () => {
      const raw = { ...entryOf(status, NOW), token: 'secret', url: 'https://example.org' };
      const parsed = parseRegistryEntry(raw) as RegistryEntry;
      expect(Object.keys(parsed).sort().join(',')).toBe(Object.keys(entryOf(status, NOW)).sort().join(','));
    });
  });

  await describe('isAlive', async () => {
    await it('is the heartbeat, three beats wide', async () => {
      expect(STALE_MS).toBe(3 * HEARTBEAT_MS);
      expect(isAlive(entry({ updatedAt: ago(0) }), NOW)).toBe(true);
      expect(isAlive(entry({ updatedAt: ago(STALE_MS) }), NOW)).toBe(true);
      expect(isAlive(entry({ updatedAt: ago(STALE_MS + 1) }), NOW)).toBe(false);
    });

    await it('counts an entry dated in the future as alive (a clock that moved back)', async () => {
      expect(isAlive(entry({ updatedAt: ago(-60_000) }), NOW)).toBe(true);
    });
  });

  await describe('statusOf', async () => {
    await it('no entry at all is no-bridge: an alarm with an empty list, not a quiet state', async () => {
      expect(statusOf([], NOW)).toStrictEqual({ presence: 'no-bridge', sessions: [] });
    });

    await it('only dead entries is no-bridge too', async () => {
      const dead = entry({ updatedAt: ago(STALE_MS + 1) });
      expect(statusOf([dead], NOW).presence).toBe('no-bridge');
      expect(statusOf([dead], NOW).sessions.length).toBe(0);
    });

    await it('a live bridge with no browser is no-browser', async () => {
      const s = statusOf([entry({ browsers: [] })], NOW);
      expect(s.presence).toBe('no-browser');
      expect(s.sessions.length).toBe(1);
    });

    await it('a live bridge with a browser is ready', async () => {
      expect(statusOf([entry()], NOW).presence).toBe('ready');
    });

    await it('one session with a browser is enough, however many wait without', async () => {
      const waiting = entry({ instance: 'inst-2', browsers: [] });
      expect(statusOf([waiting, entry()], NOW).presence).toBe('ready');
    });

    await it('lists live sessions oldest first, ties by instance, and leaves the dead out', async () => {
      const a = entry({ instance: 'a', startedAt: '2026-10-04T10:00:00.000Z' });
      const b = entry({ instance: 'b', startedAt: '2026-10-04T09:00:00.000Z' });
      const c = entry({ instance: 'c', startedAt: '2026-10-04T09:00:00.000Z' });
      const dead = entry({ instance: 'd', updatedAt: ago(STALE_MS + 1) });
      expect(
        statusOf([a, c, dead, b], NOW)
          .sessions.map((s) => s.instance)
          .join(''),
      ).toBe('bca');
    });
  });

  await describe('sweepable', async () => {
    await it('is what has been dead for more than a minute beyond the heartbeat window', async () => {
      const fresh = entry({ instance: 'fresh', updatedAt: ago(1_000) });
      const justDead = entry({ instance: 'just', updatedAt: ago(STALE_MS + 1) });
      const longDead = entry({ instance: 'long', updatedAt: ago(STALE_MS + 60_001) });
      expect(sweepable([fresh, justDead, longDead], NOW).map((e) => e.instance)).toStrictEqual(['long']);
    });
  });

  await describe('unregisteredPorts', async () => {
    await it('is the listening ports no live session announced, sorted and once', async () => {
      const a = entry({ instance: 'a', port: 47814 });
      expect(unregisteredPorts([47815, 47813, 47814, 47813], [a])).toStrictEqual([47813, 47815]);
    });

    await it('is empty when everything that listens announced itself, or nothing listens', async () => {
      expect(unregisteredPorts([47813], [entry({ port: 47813 })])).toStrictEqual([]);
      expect(unregisteredPorts([], [])).toStrictEqual([]);
    });
  });
};
