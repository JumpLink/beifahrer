import { describe, expect, it } from '@gjsify/unit';

import { TARGETS, manifestFor, type Target } from '../../../../extension/manifest.ts';

/**
 * `@gjsify/unit`'s `toEqual` cannot deep-compare a plain object on GJS — it reports identical
 * objects as unequal — so an exact object comparison goes through its JSON, and arrays through
 * `toEqualArray`, which is what the rest of this suite tree uses.
 */
const sameJson = (actual: unknown, expected: unknown): void => {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
};

/** The keys this suite reads, so a missing one is a type error rather than a silent undefined. */
interface Manifest {
  manifest_version: number;
  version: string;
  background: Record<string, unknown>;
  browser_specific_settings?: unknown;
}

/**
 * The target list and the manifest per target.
 *
 * This suite lives in the app workspace because that is where the unit-test harness is
 * (`gjsify test`, app/tests/test.mts); extension/manifest.ts is pure and imports nothing, so it
 * runs on Node and GJS like every other suite here.
 */
const at = (target: Target, version = '1.2.3'): Manifest =>
  manifestFor(target, { version }) as unknown as Manifest;

export default async () => {
  await describe('TARGETS', async () => {
    // Every target that gets built and, since `zip`, published as its own download. A target
    // missing here is one no store ever receives, which is why the list is asserted rather than
    // left to the build's own loop.
    await it('carries every browser beifahrer publishes for', async () => {
      expect([...TARGETS].sort()).toEqualArray(['chrome-mv3', 'edge-mv3', 'firefox-mv2', 'safari-mv3']);
    });
  });

  await describe('manifestFor', async () => {
    // Edge is Chromium: one engine, one manifest. Asserting the two are equal is what makes
    // `edge-mv3` a first-class target rather than a name — a target that needs a manifest of its
    // own has to fail here and be argued for, not drift in unnoticed.
    await it('gives edge-mv3 exactly the chrome-mv3 manifest', async () => {
      sameJson(at('edge-mv3'), at('chrome-mv3'));
    });

    await it('builds edge-mv3 as Chromium MV3: a service worker and no gecko keys', async () => {
      const edge = at('edge-mv3');
      expect(edge.manifest_version).toBe(3);
      // Not Safari's background PAGE: Edge runs the worker, and the bundle connects at once there (the
      // hang is Safari's alone — AGENTS.md "Traps already paid for").
      expect(edge.background['service_worker']).toBe('background.js');
      expect(edge.background['scripts']).toBe(undefined);
      expect(edge.browser_specific_settings).toBe(undefined);
    });

    await it('keeps the three flavours apart where they really differ', async () => {
      // Firefox alone: MV2, a background script, and the gecko id AMO signs against — the one key
      // no other target may carry, since it is what makes a build installable as a Firefox add-on.
      const ff = at('firefox-mv2');
      expect(ff.manifest_version).toBe(2);
      sameJson(ff.background, { scripts: ['background.js'] });
      sameJson(ff.browser_specific_settings, {
        gecko: {
          id: 'beifahrer@jumplink.eu',
          strict_min_version: '140.0',
          // Nothing leaves the device: the only channel is the loopback socket the person runs.
          data_collection_permissions: { required: ['none'] },
        },
      });

      // Safari alone: MV3 but a background PAGE.
      expect(at('safari-mv3').manifest_version).toBe(3);
      sameJson(at('safari-mv3').background, {
        scripts: ['background.js'],
        persistent: false,
      });
      expect(at('safari-mv3').browser_specific_settings).toBe(undefined);
    });

    await it('takes the version from the package, not from the target', async () => {
      // The target picks the engine and nothing else, so any other target-specific key would have
      // shown up as a diff against chrome-mv3 above.
      expect(at('edge-mv3', '9.9.9').version).toBe('9.9.9');
    });
  });
};
