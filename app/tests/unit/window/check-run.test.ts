import { describe, expect, it } from '@gjsify/unit';
import type { BridgeStatus } from '@beifahrer/core';

import { BridgeError } from '../../../src/bridge/bridge.ts';
import { runCheck, summarize, type CheckBridge } from '../../../src/window/check-run.ts';

const browser = (id: string, name: string, version: string) => ({
  id,
  browser: { family: 'firefox' as const, name, version },
  extension: { version: '0.1.4', manifestVersion: 3 as const },
  capabilities: [],
  connectedAt: '2026-10-04T11:05:00.000Z',
});

function fake(
  browsers: ReturnType<typeof browser>[],
  answer: (id: string) => Promise<{ tabs: unknown[] }>,
): CheckBridge & { stopped: number; calls: string[] } {
  const f = {
    stopped: 0,
    calls: [] as string[],
    status: () => ({ browsers }) as unknown as BridgeStatus,
    waitForConnection: () => Promise.resolve(undefined),
    call: (method: string, _p: unknown, id?: string) => {
      f.calls.push(`${method}:${id}`);
      return answer(id ?? '');
    },
    stop: () => {
      f.stopped++;
      return Promise.resolve();
    },
  };
  return f as unknown as CheckBridge & { stopped: number; calls: string[] };
}

const refusal = (code: 'paused' | 'forbidden' | 'feature_disabled') =>
  new BridgeError({ code, message: 'no' });

export default async () => {
  await describe('runCheck', async () => {
    await it('asks only tabs.list, by connection id, and ends its session', async () => {
      const b = fake([browser('c1', 'Firefox', '155.0')], () => Promise.resolve({ tabs: [1, 2, 3] }));
      const r = await runCheck(() => Promise.resolve(b), 0);
      expect(JSON.stringify(r)).toBe(
        JSON.stringify({ kind: 'answered', browsers: ['Firefox 155.0'], tabs: 3 }),
      );
      expect(b.calls.join()).toBe('tabs.list:c1');
      expect(b.stopped).toBe(1);
    });

    await it('reports no browser when none connected', async () => {
      const b = fake([], () => Promise.resolve({ tabs: [] }));
      expect((await runCheck(() => Promise.resolve(b), 0)).kind).toBe('nobrowser');
      expect(b.calls.length).toBe(0);
      expect(b.stopped).toBe(1);
    });

    await it('shows a pause as a refusal and does not retry', async () => {
      const b = fake([browser('c1', 'Firefox', '155.0')], () => Promise.reject(refusal('paused')));
      expect(JSON.stringify(await runCheck(() => Promise.resolve(b), 0))).toBe(
        JSON.stringify({
          kind: 'refused',
          reason: 'paused',
          browsers: ['Firefox 155.0'],
        }),
      );
      expect(b.calls.length).toBe(1);
    });

    await it('maps the other gates to their own reasons', async () => {
      expect(JSON.stringify(summarize([{ name: 'F 1', error: refusal('feature_disabled') }]))).toBe(
        JSON.stringify({
          kind: 'refused',
          reason: 'feature_disabled',
          browsers: ['F 1'],
        }),
      );
      expect(summarize([{ name: 'F 1', error: refusal('forbidden') }]).kind).toBe('refused');
    });

    await it('counts as answered when one of two browsers answers', async () => {
      const b = fake([browser('c1', 'Firefox', '155.0'), browser('c2', 'Chromium', '140')], (id) =>
        id === 'c1' ? Promise.reject(refusal('paused')) : Promise.resolve({ tabs: [1] }),
      );
      expect(JSON.stringify(await runCheck(() => Promise.resolve(b), 0))).toBe(
        JSON.stringify({
          kind: 'answered',
          browsers: ['Chromium 140'],
          tabs: 1,
        }),
      );
    });

    await it('fails with the reason when the session cannot open or the call breaks', async () => {
      const r = await runCheck(() => Promise.reject(new Error('all ports busy')), 0);
      expect(JSON.stringify(r)).toBe(JSON.stringify({ kind: 'failed', reason: 'all ports busy' }));
      const b = fake([browser('c1', 'Firefox', '155.0')], () => Promise.reject(new Error('boom')));
      expect(JSON.stringify(await runCheck(() => Promise.resolve(b), 0))).toBe(
        JSON.stringify({ kind: 'failed', reason: 'boom' }),
      );
    });
  });
};
