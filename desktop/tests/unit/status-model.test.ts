import { describe, expect, it } from '@gjsify/unit';
import { entryOf, statusOf, type BridgeStatus } from '@beifahrer/core';

import { createTranslate } from '../../src/i18n.ts';
import { viewOf } from '../../src/status-model.ts';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const bridge = (instance: string, browsers: string[]): BridgeStatus => ({
  port: 47813,
  version: '0.1.4',
  session: { label: `agent-${instance}`, pid: 1, instance, startedAt: '2026-10-04T11:00:00.000Z' },
  browsers: browsers.map((name, i) => ({
    id: `b${i}`,
    browser: { family: 'firefox' as const, name, version: '155.0' },
    extension: { version: '0.1.4', manifestVersion: 3 as const },
    capabilities: [],
    connectedAt: '2026-10-04T11:05:00.000Z',
  })),
});
const view = (
  statuses: BridgeStatus[],
  skipped = 0,
  locale: 'en' | 'de' = 'en',
  unregistered: number[] = [],
) =>
  viewOf(
    statusOf(
      statuses.map((s) => entryOf(s, NOW)),
      NOW,
    ),
    skipped,
    createTranslate(locale),
    unregistered,
  );

// The window is a view over the registry (ADR 0015) and speaks the ladder of ADR 0014: a missing
// connection is an alarm with a next step, never an empty list.
export default async () => {
  await describe('status view', async () => {
    await it('no session is an alarm that says what to do, with nothing to list', async () => {
      const v = view([]);
      expect(v.alarm).toBe(true);
      expect(v.presence).toBe('no-bridge');
      expect(v.title).toBe('No agent session running');
      expect(v.description).toMatch(/Start an agent/);
      expect(v.sessions.length).toBe(0);
    });

    await it('a session without a browser is an alarm that names the next step', async () => {
      const v = view([bridge('a', [])]);
      expect(v.alarm).toBe(true);
      expect(v.title).toBe('No browser connected');
      expect(v.description).toMatch(/pairing token/);
      expect(v.sessions[0]!.subtitle).toBe('Port 47813 · no browser');
    });

    await it('a session with a browser is the quiet state', async () => {
      const v = view([bridge('a', ['Firefox', 'Chromium'])]);
      expect(v.alarm).toBe(false);
      expect(v.title).toBe('Ready');
      expect(v.sessions[0]!.title).toBe('agent-a');
      expect(v.sessions[0]!.subtitle).toBe('Port 47813 · Firefox 155.0, Chromium 155.0');
    });

    await it('says the unreadable files count, and nothing when there are none', async () => {
      expect(view([], 0).note).toBe(null);
      expect(view([], 3).note).toBe('3 registry files could not be read.');
    });

    await it('warns about a port something holds that no session announced, one line for all of them', async () => {
      expect(view([], 0).warnings.length).toBe(0);
      const one = view([], 0, 'en', [47813]).warnings;
      expect(one.length).toBe(1);
      expect(one[0]!.title).toBe('Port 47813 is held by something that does not report');
      expect(one[0]!.description).toMatch(/restart the agent session/);
      expect(view([], 0, 'en', [47813, 47815]).warnings[0]!.title).toBe(
        'Ports 47813, 47815 are held by something that does not report',
      );
      expect(view([], 0, 'de', [47813]).warnings[0]!.title).toBe(
        'Port 47813 wird von etwas gehalten, das sich nicht meldet',
      );
    });

    await it("follows the person's language", async () => {
      expect(view([], 0, 'de').title).toBe('Keine Agent-Sitzung aktiv');
    });

    await it("never offers an action on the browser's policy: the view has no field for one", async () => {
      // ADR 0005: only the person pauses or resumes, in the browser. A view that grew a
      // pause/resume/level field would be the first step to a button for it.
      expect(
        Object.keys(view([bridge('a', ['Firefox'])]))
          .sort()
          .join(),
      ).toBe('alarm,description,icon,note,presence,sessions,title,warnings');
    });
  });
};
