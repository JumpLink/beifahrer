import { describe, expect, it } from '@gjsify/unit';

import {
  isSetupFinished,
  mergeSection,
  parseSetupDone,
  shouldMarkDone,
  startView,
} from '../../../src/window/setup-state-model.ts';

export default async () => {
  await describe('setup flag', async () => {
    await it('is done only on a literal true', async () => {
      expect(parseSetupDone(null)).toBe(false);
      expect(parseSetupDone('not json')).toBe(false);
      expect(parseSetupDone('{}')).toBe(false);
      expect(parseSetupDone('{"setup":{"done":"yes"}}')).toBe(false);
      expect(parseSetupDone('{"setup":{"done":true}}')).toBe(true);
    });

    await it('marks done at the first pairing, once', async () => {
      expect(shouldMarkDone(false, true)).toBe(true);
      expect(shouldMarkDone(false, false)).toBe(false);
      expect(shouldMarkDone(true, true)).toBe(false);
    });
  });

  await describe('start view', async () => {
    await it('opens the assistant on a first run', async () => {
      expect(startView(false, false)).toBe('setup');
    });

    await it('opens the tabs once the flag is set, even where agent configs are unreadable', async () => {
      expect(startView(true, false)).toBe('tabs');
    });

    await it('counts an existing agent config as finished, as a hint only', async () => {
      expect(startView(false, true)).toBe('tabs');
      expect(isSetupFinished(false, true)).toBe(true);
      expect(isSetupFinished(false, false)).toBe(false);
    });
  });

  await describe('window file sections', async () => {
    await it('keeps the other sections when one is written', async () => {
      const autostart = '{"autostart":{"enabled":true,"asked":true}}';
      const merged = JSON.parse(mergeSection(autostart, 'setup', { done: true }));
      expect(merged.autostart.enabled).toBe(true);
      expect(merged.setup.done).toBe(true);
    });

    await it('replaces its own section and survives a damaged file', async () => {
      const once = mergeSection(null, 'setup', { done: false });
      expect(JSON.parse(mergeSection(once, 'setup', { done: true })).setup.done).toBe(true);
      expect(JSON.parse(mergeSection('garbage', 'setup', { done: true })).setup.done).toBe(true);
      expect(JSON.parse(mergeSection('[1]', 'setup', { done: true })).setup.done).toBe(true);
    });
  });
};
