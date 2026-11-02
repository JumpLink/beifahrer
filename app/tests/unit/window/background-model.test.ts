import { describe, expect, it } from '@gjsify/unit';
import { entryOf, statusOf, type BridgeStatus } from '@beifahrer/core';

import { backgroundLine, clip, inFlatpak, onClose } from '../../../src/window/background-model.ts';
import { createTranslate } from '../../../src/window/i18n.ts';
import { viewOf } from '../../../src/window/status-model.ts';

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
const line = (statuses: BridgeStatus[], locale: 'en' | 'de' = 'en') => {
  const t = createTranslate(locale);
  return backgroundLine(
    viewOf(
      statusOf(
        statuses.map((s) => entryOf(s, NOW)),
        NOW,
      ),
      0,
      t,
    ),
    t,
  );
};

export default async () => {
  await describe('onClose', async () => {
    await it('hides when the portal granted', async () => {
      expect(onClose({ statusIcon: false, background: 'granted' })).toBe('hide');
    });
    await it('hides when a status icon is shown, whatever the portal said', async () => {
      expect(onClose({ statusIcon: true, background: 'unavailable' })).toBe('hide');
      expect(onClose({ statusIcon: true, background: 'denied' })).toBe('hide');
    });
    await it('quits when nothing lets the person get it back', async () => {
      expect(onClose({ statusIcon: false, background: 'denied' })).toBe('quit');
      expect(onClose({ statusIcon: false, background: 'unavailable' })).toBe('quit');
    });
  });

  await describe('clip', async () => {
    await it('keeps a short text and cuts a long one to 96 characters with an ellipsis', async () => {
      expect(clip('short')).toBe('short');
      expect(clip('x'.repeat(96))).toBe('x'.repeat(96));
      const cut = clip('y'.repeat(200));
      expect([...cut].length).toBe(96);
      expect(cut.endsWith('…')).toBe(true);
    });
    await it('counts characters, not UTF-16 units', async () => {
      expect([...clip('🦊'.repeat(120))].length).toBe(96);
    });
  });

  await describe('backgroundLine', async () => {
    await it('says the alarm rungs by their title', async () => {
      expect(line([])).toBe('No agent session running');
      expect(line([bridge('a', [])])).toBe('No browser connected');
    });
    await it('counts the sessions when ready, in both languages', async () => {
      expect(line([bridge('a', ['Firefox'])])).toBe('Ready: 1 agent session');
      expect(line([bridge('a', ['Firefox']), bridge('b', ['Firefox'])])).toBe('Ready: 2 agent sessions');
      expect(line([bridge('a', ['Firefox'])], 'de')).toBe('Bereit: 1 Agentensitzung');
    });
    await it('never passes the portal limit', async () => {
      expect([...line([bridge('a', ['Firefox'])])].length <= 96).toBe(true);
    });
  });

  await describe('inFlatpak', async () => {
    await it('is true for the info file or FLATPAK_ID, false for neither', async () => {
      expect(inFlatpak(true, {})).toBe(true);
      expect(inFlatpak(false, { FLATPAK_ID: 'eu.jumplink.beifahrer' })).toBe(true);
      expect(inFlatpak(false, {})).toBe(false);
    });
  });
};
