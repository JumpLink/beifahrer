import { describe, expect, it } from '@gjsify/unit';

import {
  DEFAULT_PORT,
  DEFAULT_PORT_COUNT,
  MAX_PORT_COUNT,
  PortRangeFull,
  bindFirstFree,
  describeRange,
  parsePortRange,
  portsOf,
} from '@beifahrer/core';

export default async () => {
  await describe('parsePortRange', async () => {
    await it('defaults to 47813 and ten ports', async () => {
      expect(DEFAULT_PORT).toBe(47813);
      expect(DEFAULT_PORT_COUNT).toBe(10);
      const r = parsePortRange(undefined, undefined);
      expect(r.base).toBe(47813);
      expect(r.count).toBe(10);
      expect(describeRange(r)).toBe('47813–47822');
    });

    await it('reads numbers and numeric strings (env, storage)', async () => {
      const r = parsePortRange('47900', '3');
      expect(r.base).toBe(47900);
      expect(r.count).toBe(3);
      expect(portsOf(r).join(',')).toBe('47900,47901,47902');
      expect(describeRange({ base: 5000, count: 1 })).toBe('5000');
    });

    await it('falls back field by field on nonsense, never widening the range', async () => {
      expect(parsePortRange('abc', 3).base).toBe(DEFAULT_PORT);
      expect(parsePortRange('', 3).base).toBe(DEFAULT_PORT);
      expect(parsePortRange(80, 3).base).toBe(DEFAULT_PORT);
      expect(parsePortRange(70000, 3).base).toBe(DEFAULT_PORT);
      expect(parsePortRange(47900, 0).count).toBe(DEFAULT_PORT_COUNT);
      expect(parsePortRange(47900, 2.5).count).toBe(DEFAULT_PORT_COUNT);
      expect(parsePortRange(47900, MAX_PORT_COUNT + 1).count).toBe(DEFAULT_PORT_COUNT);
      expect(parsePortRange(47900, MAX_PORT_COUNT).count).toBe(MAX_PORT_COUNT);
    });

    await it('ends the range at 65535', async () => {
      const r = parsePortRange(65530, 10);
      expect(r.count).toBe(6);
      expect(portsOf(r).at(-1)).toBe(65535);
    });
  });

  await describe('bindFirstFree', async () => {
    await it('takes the first port whose bind succeeds, in order', async () => {
      const tried: number[] = [];
      const got = await bindFirstFree({ base: 100, count: 4 }, async (port) => {
        tried.push(port);
        if (port < 102) throw new Error('taken');
        return `bound ${port}`;
      });
      expect(got.port).toBe(102);
      expect(got.value).toBe('bound 102');
      expect(tried.join(',')).toBe('100,101,102');
    });

    await it('moves on after ANY bind error, and reports a full range with the last error', async () => {
      let caught: unknown;
      await bindFirstFree({ base: 100, count: 2 }, async (port) => {
        throw new Error(port === 100 ? 'Die Adresse wird bereits verwendet' : 'something else');
      }).catch((e) => (caught = e));
      expect(caught instanceof PortRangeFull).toBe(true);
      expect((caught as PortRangeFull).errors.length).toBe(2);
      expect((caught as Error).message).toMatch(/100–101/);
      expect((caught as Error).message).toMatch(/something else/);
      expect((caught as Error).message).toMatch(/BEIFAHRER_PORT_COUNT/);
    });
  });
};
