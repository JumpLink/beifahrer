import { describe, expect, it } from '@gjsify/unit';
import { entryOf, type BridgeStatus } from '@beifahrer/core';

import { renderStatus, reportOf } from '../../../src/frontends/cli/status.ts';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const status = (instance: string, browsers: number): BridgeStatus => ({
  port: 47813,
  version: '0.1.4',
  session: { label: `agent-${instance}`, pid: 1, instance, startedAt: '2026-10-04T11:00:00.000Z' },
  browsers: Array.from({ length: browsers }, (_, i) => ({
    id: `b${i}`,
    browser: { family: 'firefox' as const, name: 'Firefox', version: '155.0' },
    extension: { version: '0.1.4', manifestVersion: 3 as const },
    capabilities: [],
    connectedAt: '2026-10-04T11:05:00.000Z',
  })),
});

export default async () => {
  await describe('beifahrer status', async () => {
    await it('says what to do when no session runs, as an alarm and not an empty list', async () => {
      const text = renderStatus(reportOf([], 0, NOW));
      expect(text).toMatch(/No agent session is running/);
      expect(text).toMatch(/Start an agent/);
    });

    await it('names the next step when a session has no browser', async () => {
      const text = renderStatus(reportOf([entryOf(status('a', 0), NOW)], 0, NOW));
      expect(text).toMatch(/1 agent session is running, but no browser is connected to it/);
      expect(text).toMatch(/beifahrer token/);
      expect(text).toMatch(/agent-a/);
    });

    await it('lists sessions and their browsers when ready', async () => {
      const text = renderStatus(
        reportOf([entryOf(status('a', 1), NOW), entryOf(status('b', 0), NOW)], 0, NOW),
      );
      expect(text).toMatch(/2 agent sessions running, a browser is connected/);
      expect(text).toMatch(/Firefox 155.0 {2}extension 0.1.4 {2}\(b0\)/);
    });

    await it('counts unreadable registry files', async () => {
      expect(renderStatus(reportOf([], 2, NOW))).toMatch(/2 files in the registry could not be read/);
    });

    await it('names a port that listens without a session, and what to do about it', async () => {
      const text = renderStatus(reportOf([entryOf(status('a', 1), NOW)], 0, NOW, [47813, 47814]));
      // status() announces port 47813, so only 47814 is a stranger.
      expect(text).toMatch(/Port 47814 is held by something that no running Beifahrer session announced/);
      expect(text).toMatch(/restart the agent session/);
      expect(renderStatus(reportOf([], 0, NOW, [47813, 47814]))).toMatch(/Ports 47813, 47814 are held/);
    });

    await it('says nothing about ports when every listener announced itself', async () => {
      const text = renderStatus(reportOf([entryOf(status('a', 1), NOW)], 0, NOW, [47813]));
      expect(text).not.toMatch(/held by something/);
    });

    await it('the JSON form is the status plus the count of what was skipped', async () => {
      const report = reportOf([entryOf(status('a', 1), NOW)], 1, NOW);
      expect(report.presence).toBe('ready');
      expect(report.skipped).toBe(1);
      expect(report.unregistered).toStrictEqual([]);
      expect(report.sessions.length).toBe(1);
    });
  });
};
