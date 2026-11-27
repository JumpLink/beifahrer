import { describe, expect, it } from '@gjsify/unit';

import { verdictOf } from '@beifahrer/core';

import { MutationProbe } from '../../../../extension/src/act-probe.ts';

// Mutation noise against real change. The observer is a fake that hands the probe whatever records the
// test queues, so the rules (same value, style throttle, ignored nodes) are tested without a DOM.
type Rec = Record<string, unknown>;

function setup(opts: { ignore?: (n: Node) => boolean; noisy?: boolean } = {}) {
  let t = 0;
  let queue: Rec[] = [];
  const doc = { readyState: 'complete', querySelectorAll: () => [] as never[] };
  class FakeObserver {
    observe() {}
    takeRecords() {
      const out = queue;
      queue = [];
      return out as unknown as MutationRecord[];
    }
  }
  const probe = new MutationProbe({
    doc,
    Observer: FakeObserver as unknown as never,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      if (opts.noisy)
        queue.push({ type: 'childList', target: {}, addedNodes: [{}], removedNodes: [] } as Rec);
    },
    id: 'doc-1',
    url: () => 'https://x.test/',
    ...(opts.ignore ? { ignore: opts.ignore } : {}),
  });
  return {
    probe,
    doc,
    push: (r: Rec) => queue.push(r),
    tick: (ms: number) => void (t += ms),
    time: () => t,
  };
}

const el = (attrs: Record<string, string>) => ({
  getAttribute: (n: string) => attrs[n] ?? null,
});

export default async () => {
  await describe('MutationProbe', async () => {
    await it('ignores an attribute written with the value it had', async () => {
      const w = setup();
      w.push({ type: 'attributes', attributeName: 'class', oldValue: 'a', target: el({ class: 'a' }) });
      expect(w.probe.snapshot().n).toBe(0);
    });

    await it('counts an attribute that really changed', async () => {
      const w = setup();
      w.push({ type: 'attributes', attributeName: 'class', oldValue: 'a', target: el({ class: 'b' }) });
      expect(w.probe.snapshot().n).toBe(1);
    });

    await it('counts a style change once per element per 200 ms', async () => {
      const w = setup();
      const target = el({ style: 'x' });
      for (let i = 0; i < 5; i++) {
        w.push({ type: 'attributes', attributeName: 'style', oldValue: `o${i}`, target });
        w.probe.flush();
        w.tick(30);
      }
      expect(w.probe.n).toBe(1);
      w.tick(200);
      w.push({ type: 'attributes', attributeName: 'style', oldValue: 'z', target });
      expect(w.probe.snapshot().n).toBe(2);
    });

    await it('ignores character data that kept its text, counts one that did not', async () => {
      const w = setup();
      w.push({ type: 'characterData', oldValue: 'tick', target: { data: 'tick' } });
      expect(w.probe.snapshot().n).toBe(0);
      w.push({ type: 'characterData', oldValue: 'tick', target: { data: 'tock' } });
      expect(w.probe.snapshot().n).toBe(1);
    });

    await it('counts added nodes, but not the ones the agent put there itself', async () => {
      const pill = { nodeName: 'BEIFAHRER-INDICATOR' } as unknown as Node;
      const w = setup({ ignore: (n) => n === pill });
      w.push({ type: 'childList', target: {}, addedNodes: [pill], removedNodes: [] });
      expect(w.probe.snapshot().n).toBe(0);
      w.push({ type: 'childList', target: {}, addedNodes: [{}], removedNodes: [] });
      expect(w.probe.snapshot().n).toBe(1);
    });

    await it('is quiet after the window, and a real mutation restarts it', async () => {
      const w = setup();
      const first = await w.probe.quiet(80, 800);
      expect(first.quiet).toBe(true);
      expect(w.time() >= 80).toBe(true);
      w.push({ type: 'childList', target: {}, addedNodes: [{}], removedNodes: [] });
      const before = w.time();
      const second = await w.probe.quiet(80, 800);
      expect(second.quiet).toBe(true);
      expect(w.time() - before >= 80).toBe(true);
    });

    await it('gives up after maxMs on a page that never stops, and says it was not quiet', async () => {
      const w = setup({ noisy: true });
      const res = await w.probe.quiet(80, 300);
      expect(res.quiet).toBe(false);
      expect(w.time() >= 300).toBe(true);
    });

    await it('turns noise into verdict none and a real change into verdict changed', async () => {
      const w = setup();
      const before = w.probe.snapshot();
      w.push({ type: 'attributes', attributeName: 'class', oldValue: 'a', target: el({ class: 'a' }) });
      w.push({ type: 'characterData', oldValue: 't', target: { data: 't' } });
      expect(verdictOf(before, w.probe.snapshot()).change).toBe('none');
      w.push({ type: 'childList', target: {}, addedNodes: [{}], removedNodes: [] });
      expect(verdictOf(before, w.probe.snapshot()).change).toBe('changed');
    });

    await it('is not quiet while the document is loading', async () => {
      const w = setup();
      w.doc.readyState = 'loading';
      const res = await w.probe.quiet(80, 100);
      expect(res.ready).toBe(false);
      expect(res.quiet).toBe(false);
    });
  });
};
