import { describe, expect, it } from '@gjsify/unit';

import { oncePerRealm } from '../../../../extension/scripts/guard-once.ts';

/**
 * The once-per-realm wrap of the page-agent bundle (issue #138).
 *
 * This suite lives in the app workspace because that is where the unit-test harness is
 * (`gjsify test`, app/tests/test.mts); extension/scripts/guard-once.ts is pure and imports
 * nothing, so it runs on Node and GJS like every other suite here.
 */
export default async () => {
  await describe('oncePerRealm', async () => {
    await it('wraps the bundle in a flag check on globalThis', async () => {
      const wrapped = oncePerRealm('run();');
      expect(wrapped.startsWith('if (!globalThis.__beifahrerAgentLoaded) {')).toBe(true);
      expect(wrapped).toContain('globalThis.__beifahrerAgentLoaded = true;');
      expect(wrapped).toContain('run();');
    });

    // The regression itself, as far as a unit test can see it: a second evaluation of the wrapped
    // bundle runs NOTHING — no top-level side effect of a dependency gets a second chance to throw
    // (the Gio resource registry claimed twice, issue #138).
    await it('runs the body once when the same realm evaluates it twice', async () => {
      // `globalThis` and `count` are PARAMETERS, so the wrap sees a stand-in realm and the body a
      // counter — one evaluation is visible without touching this process's real global.
      const run = new Function(
        'globalThis',
        'count',
        `${oncePerRealm('count = count + 1;')}\nreturn count;`,
      ) as (realm: Record<string, unknown>, count: number) => number;
      const realm: Record<string, unknown> = {};
      expect(run(realm, 0)).toBe(1);
      expect(run(realm, 0)).toBe(0);
      expect(realm['__beifahrerAgentLoaded']).toBe(true);
    });

    await it('keeps a fresh realm free to evaluate it again', async () => {
      const run = new Function(
        'globalThis',
        'count',
        `${oncePerRealm('count = count + 1;')}\nreturn count;`,
      ) as (realm: Record<string, unknown>, count: number) => number;
      // A navigation creates a new isolated world, so the guard must not leak across realms: one
      // flag per realm is exactly the lifetime the agent's own `__beifahrer*` guards have.
      expect(run({}, 0)).toBe(1);
      expect(run({}, 0)).toBe(1);
    });
  });
};
