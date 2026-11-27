import { describe, expect, it } from '@gjsify/unit';

import { COUNTED, InflightTracker } from '../../../../extension/src/inflight-tracker.ts';

export default async () => {
  await describe('InflightTracker', async () => {
    await it('counts the open requests of one tab, not of another', async () => {
      const t = new InflightTracker();
      t.start('a', 1, 0);
      t.start('b', 1, 0);
      t.start('c', 2, 0);
      expect(t.count(1, 100)).toBe(2);
      expect(t.count(2, 100)).toBe(1);
    });

    await it('drops a request when it ends', async () => {
      const t = new InflightTracker();
      t.start('a', 1, 0);
      t.end('a');
      expect(t.count(1, 100)).toBe(0);
    });

    await it('stops counting a request older than the window — a long poll does not hold the page', async () => {
      const t = new InflightTracker();
      t.start('poll', 1, 0);
      expect(t.count(1, 1_400)).toBe(1);
      expect(t.count(1, 1_600)).toBe(0);
    });

    await it('counts a redirect chain once, from its first start', async () => {
      const t = new InflightTracker();
      t.start('r', 1, 0);
      t.start('r', 1, 1_000);
      expect(t.count(1, 1_600)).toBe(0);
    });

    await it('forgets a tab that closed', async () => {
      const t = new InflightTracker();
      t.start('a', 1, 0);
      t.forgetTab(1);
      expect(t.count(1, 10)).toBe(0);
    });

    await it('counts documents and XHR/fetch, not images', async () => {
      for (const type of ['main_frame', 'sub_frame', 'xmlhttprequest', 'fetch'])
        expect(COUNTED.has(type)).toBe(true);
      for (const type of ['image', 'font', 'ping', 'stylesheet']) expect(COUNTED.has(type)).toBe(false);
    });
  });
};
