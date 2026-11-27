import { describe, expect, it } from '@gjsify/unit';
import {
  runSettle,
  SETTLE_CAP_MS,
  SETTLE_CAP_NAVIGATION_MS,
  type PageQuiet,
  type SettleDeps,
} from '@beifahrer/core';

// The settle loop is decided here with a scripted clock: the page's answers, the tab's loading flag and
// the requests in flight are scripts, and `sleep` moves the clock.
function world(opts: {
  answers: (t: number) => PageQuiet | undefined;
  inflight?: (t: number) => number;
  loading?: (t: number) => boolean;
}) {
  let t = 0;
  const deps: SettleDeps = {
    now: () => t,
    sleep: async (ms) => void (t += ms),
    ask: async (_q, max) => {
      const a = opts.answers(t);
      t += Math.min(max, 10);
      return a;
    },
    inflight: () => opts.inflight?.(t) ?? 0,
    loading: async () => opts.loading?.(t) ?? false,
  };
  return { deps, time: () => t };
}

const still: PageQuiet = { doc: 'd1', url: 'https://x.test/', n: 0, ready: true, quiet: true };

export default async () => {
  await describe('runSettle', async () => {
    await it('answers quiet at once for a page that is already still', async () => {
      const w = world({ answers: () => still });
      const out = await runSettle(w.deps);
      expect(out.settled).toBe('quiet');
      expect(out.ms < 100).toBe(true);
    });

    await it('keeps waiting while the page is busy, and answers quiet when it stops', async () => {
      const w = world({ answers: (t) => ({ ...still, quiet: t >= 300 }) });
      const out = await runSettle(w.deps);
      expect(out.settled).toBe('quiet');
      expect(out.ms >= 300).toBe(true);
    });

    await it('is held by a request still in flight, and released when it ends', async () => {
      const w = world({ answers: () => still, inflight: (t) => (t < 500 ? 1 : 0) });
      const out = await runSettle(w.deps);
      expect(out.settled).toBe('quiet');
      expect(out.ms >= 500).toBe(true);
    });

    await it('gives up at the cap and says so', async () => {
      const w = world({ answers: () => ({ ...still, quiet: false }) });
      const out = await runSettle(w.deps);
      expect(out.settled).toBe('cap');
      expect(out.ms >= SETTLE_CAP_MS).toBe(true);
      expect(out.ms < SETTLE_CAP_MS + 200).toBe(true);
    });

    await it('allows a navigation the longer cap', async () => {
      const w = world({ answers: () => ({ ...still, quiet: false }) });
      const out = await runSettle(w.deps, { navigation: true });
      expect(out.settled).toBe('cap');
      expect(out.ms >= SETTLE_CAP_NAVIGATION_MS).toBe(true);
    });

    await it('treats a replaced document as a navigation and extends the cap', async () => {
      // The old document does not answer, the new one is busy for 1.5 s: past the plain cap.
      const w = world({
        answers: (t) => (t < 100 ? undefined : { ...still, doc: 'd2', quiet: t >= 1500 }),
      });
      const out = await runSettle(w.deps, { doc: 'd1' });
      expect(out.navigated).toBe(true);
      expect(out.settled).toBe('quiet');
    });

    await it('does not call a tab that is still loading quiet', async () => {
      const w = world({ answers: () => still, loading: (t) => t < 400 });
      const out = await runSettle(w.deps);
      expect(out.ms >= 400).toBe(true);
    });
  });
};
