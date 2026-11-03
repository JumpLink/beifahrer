import { describe, expect, it } from '@gjsify/unit';

import { openOptions, type OptionsApi } from '../../../../extension/src/ui/open-options.ts';

function fake(openOptionsPage: () => Promise<void>) {
  const created: string[] = [];
  const api: OptionsApi = {
    runtime: { openOptionsPage, getURL: (p) => `moz-extension://x${p}` },
    tabs: {
      create: async ({ url }) => {
        created.push(url);
      },
    },
  };
  return { api, created };
}

export default async () => {
  await describe('openOptions', async () => {
    await it('asks the browser for the options page and closes the popup', async () => {
      let opened = 0;
      let closed = 0;
      const { api, created } = fake(async () => void opened++);
      await openOptions(api, '', () => closed++);
      expect(opened).toBe(1);
      expect(created.length).toBe(0);
      expect(closed).toBe(1);
    });

    await it('opens the page in a tab when openOptionsPage rejects', async () => {
      let closed = 0;
      const { api, created } = fake(() => Promise.reject(new Error('no')));
      await openOptions(api, '', () => closed++);
      expect(created.length).toBe(1);
      expect(created[0]).toBe('moz-extension://x/options.html');
      expect(closed).toBe(1);
    });

    await it('opens a hash in a tab and closes the popup', async () => {
      let closed = 0;
      const { api, created } = fake(async () => undefined);
      await openOptions(api, 'activity', () => closed++);
      expect(created[0]).toBe('moz-extension://x/options.html#activity');
      expect(closed).toBe(1);
    });
  });
};
