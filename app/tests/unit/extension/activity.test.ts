import { describe, expect, it } from '@gjsify/unit';

import type { ActivityEntry } from '@beifahrer/core';

import { persist, type SessionArea } from '../../../../extension/src/activity.ts';

/**
 * `persist()` is the one-write-fails-never-fails-the-call path (extension/src/activity.ts):
 * Safari has answered `Exceeded storage quota` to this log at well under 20 small entries, and
 * kept failing on it afterwards, so the call it rode in on must still succeed either way
 * (docs/traps-browser-platform.md incident, 2026-11-05).
 */
const ENTRIES: ActivityEntry[] = [
  { at: 1, method: 'tabs.list', words: 'listed your tabs', host: null, outcome: 'ok' },
];

export default async () => {
  await describe('persist: the log never fails the call it rides on', async () => {
    await it('does nothing when the browser has no session area', async () => {
      await persist(null, ENTRIES);
    });

    await it('writes once and returns when the browser accepts it', async () => {
      let sets = 0;
      const area: SessionArea = {
        get: async () => ({}),
        set: async () => {
          sets++;
        },
        remove: async () => {
          throw new Error('must not be called when set succeeds');
        },
      };
      await persist(area, ENTRIES);
      expect(sets).toBe(1);
    });

    await it('removes the key and retries once when the first set throws', async () => {
      let sets = 0;
      let removed = false;
      const area: SessionArea = {
        get: async () => ({}),
        set: async () => {
          sets++;
          if (sets === 1) throw new Error('Exceeded storage quota.');
        },
        remove: async () => {
          removed = true;
        },
      };
      await persist(area, ENTRIES);
      expect(sets).toBe(2);
      expect(removed).toBe(true);
    });

    await it('swallows a quota error that survives the retry: the call it rode on still succeeds', async () => {
      const area: SessionArea = {
        get: async () => ({}),
        set: async () => {
          throw new Error('Exceeded storage quota.');
        },
        remove: async () => {
          // removing does not help this time either
        },
      };
      // No throw out of persist(), whatever the storage keeps saying.
      await persist(area, ENTRIES);
    });

    await it('swallows a `remove` that itself throws', async () => {
      const area: SessionArea = {
        get: async () => ({}),
        set: async () => {
          throw new Error('Exceeded storage quota.');
        },
        remove: async () => {
          throw new Error('remove failed too');
        },
      };
      await persist(area, ENTRIES);
    });
  });
};
