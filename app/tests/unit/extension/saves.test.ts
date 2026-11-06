import { describe, expect, it } from '@gjsify/unit';

import { probeSupport } from '../../../../extension/src/saves.ts';

// `probeSupport` is the pure half of `savesPermissionSupported`: whether an async capability
// check resolves at all, or throws — which is how WebKit answers a `permissions.contains()` for
// a name it does not recognize (`'downloads' is not a valid permission`), independent of browser.
export default async () => {
  await describe('probeSupport', async () => {
    await it('answers true when the probe resolves', async () => {
      expect(await probeSupport(() => Promise.resolve(true))).toBe(true);
      expect(await probeSupport(() => Promise.resolve(false))).toBe(true);
    });
    await it('answers false when the probe rejects, for any reason', async () => {
      expect(
        await probeSupport(() => Promise.reject(new Error("'downloads' is not a valid permission"))),
      ).toBe(false);
      expect(await probeSupport(() => Promise.reject(new TypeError('unrelated')))).toBe(false);
    });
    await it('answers false when the probe throws synchronously', async () => {
      expect(
        await probeSupport(() => {
          throw new Error('sync throw');
        }),
      ).toBe(false);
    });
  });
};
