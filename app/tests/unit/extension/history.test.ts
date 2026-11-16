import { describe, expect, it } from '@gjsify/unit';
import { HISTORY_MAX_AGE_MS, HISTORY_MAX_ENTRIES, type HistoryEntry } from '@beifahrer/core';

import {
  HISTORY_ENABLED_KEY,
  HISTORY_KEY,
  clearHistory,
  readHistory,
  recordHistory,
  type LocalArea,
} from '../../../../extension/src/history.ts';

// ADR 0029: off by default writes nothing; on writes exactly five fields; clear empties; cap and age hold.
function memory(
  initial: Record<string, unknown> = {},
): LocalArea & { data: Record<string, unknown>; sets: number } {
  const area = {
    data: { ...initial },
    sets: 0,
    get: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in area.data).map((k) => [k, area.data[k]]));
    },
    set: async (items: Record<string, unknown>) => {
      area.sets++;
      Object.assign(area.data, items);
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete area.data[k];
    },
  };
  return area;
}

const NOW = 1_800_000_000_000;

export default async () => {
  await describe('history storage', async () => {
    await it('writes nothing while the switch is unset, false or malformed', async () => {
      for (const value of [undefined, false, 'true', 1, null]) {
        const area = memory(value === undefined ? {} : { [HISTORY_ENABLED_KEY]: value });
        await recordHistory(area, { method: 'page.read', url: 'https://a.example/x' }, NOW);
        expect(area.sets).toBe(0);
        expect(HISTORY_KEY in area.data).toBe(false);
      }
    });

    await it('writes exactly the five fields when on, and no path, title or label', async () => {
      const area = memory({ [HISTORY_ENABLED_KEY]: true });
      await recordHistory(
        area,
        {
          method: 'page.fill',
          url: 'https://bank.example/acct/9?token=secret#frag',
          error: { code: 'forbidden' },
          // Not part of HistoryInput; a careless caller must still not get these through.
          ...({ params: { text: 'hunter2' }, title: 'Statement', session: 'claude · private' } as object),
        },
        NOW,
      );
      const stored = area.data[HISTORY_KEY] as HistoryEntry[];
      expect(stored.length).toBe(1);
      expect(Object.keys(stored[0]).sort().join(',')).toBe('at,host,method,outcome,reason');
      expect(stored[0].host).toBe('bank.example');
      const text = JSON.stringify(area.data);
      for (const leak of ['acct', 'secret', 'frag', 'hunter2', 'Statement', 'private']) {
        expect(text.includes(leak)).toBe(false);
      }
    });

    await it('clear removes the key', async () => {
      const area = memory({ [HISTORY_ENABLED_KEY]: true });
      await recordHistory(area, { method: 'tabs.list' }, NOW);
      await clearHistory(area);
      expect(HISTORY_KEY in area.data).toBe(false);
      expect((await readHistory(area, NOW)).length).toBe(0);
    });

    await it('enforces the count cap on write', async () => {
      const area = memory({ [HISTORY_ENABLED_KEY]: true });
      for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) {
        await recordHistory(area, { method: 'tabs.list' }, NOW + i);
      }
      const stored = area.data[HISTORY_KEY] as HistoryEntry[];
      expect(stored.length).toBe(HISTORY_MAX_ENTRIES);
      expect(stored[0].at).toBe(NOW + HISTORY_MAX_ENTRIES + 4);
    });

    await it('drops entries older than the age cap on write and on read', async () => {
      const old: HistoryEntry = {
        at: NOW - HISTORY_MAX_AGE_MS - 1,
        method: 'tabs.list',
        host: null,
        outcome: 'ok',
      };
      const area = memory({ [HISTORY_ENABLED_KEY]: true, [HISTORY_KEY]: [old] });
      expect((await readHistory(area, NOW)).length).toBe(0);
      await recordHistory(area, { method: 'tabs.list' }, NOW);
      expect((area.data[HISTORY_KEY] as HistoryEntry[]).length).toBe(1);
    });

    await it('keeps what is stored when switched off, and never throws on a failing store', async () => {
      const area = memory({ [HISTORY_KEY]: [{ at: NOW, method: 'tabs.list', host: null, outcome: 'ok' }] });
      await recordHistory(area, { method: 'tabs.list' }, NOW);
      expect((await readHistory(area, NOW)).length).toBe(1);
      const broken: LocalArea = {
        get: async () => {
          throw new Error('boom');
        },
        set: async () => {
          throw new Error('boom');
        },
        remove: async () => {},
      };
      await recordHistory(broken, { method: 'tabs.list' }, NOW);
    });
  });
};
