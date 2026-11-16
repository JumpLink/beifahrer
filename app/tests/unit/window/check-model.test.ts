import { describe, expect, it } from '@gjsify/unit';

import { checkView } from '../../../src/window/check-model.ts';
import { createTranslate } from '../../../src/window/i18n.ts';

export default async () => {
  await describe('check view', async () => {
    const en = createTranslate('en');
    const de = createTranslate('de');

    await it('idle offers the check, running locks the button', async () => {
      expect(checkView({ kind: 'idle' }, en).busy).toBe(false);
      expect(checkView({ kind: 'idle' }, en).icon).toBe(null);
      expect(checkView({ kind: 'running' }, en).busy).toBe(true);
    });

    await it('says which browser answered and how many tabs, singular and plural', async () => {
      const one = checkView({ kind: 'answered', browsers: ['Firefox 155.0'], tabs: 1 }, en);
      expect(one.subtitle).toBe('Firefox 155.0 answered: 1 open tab.');
      expect(one.button).toBe('Check again');
      const many = checkView({ kind: 'answered', browsers: ['Firefox 155.0', 'Chromium 140'], tabs: 7 }, en);
      expect(many.subtitle).toBe('Firefox 155.0, Chromium 140 answered: 7 open tabs.');
      expect(checkView({ kind: 'answered', browsers: ['Firefox 155.0'], tabs: 2 }, de).subtitle).toBe(
        'Firefox 155.0 hat geantwortet: 2 offene Tabs.',
      );
    });

    await it('shows a refusal as the answer it is, with no way to lift it', async () => {
      const paused = checkView({ kind: 'refused', reason: 'paused', browsers: ['Firefox 155.0'] }, en);
      expect(paused.subtitle).toContain('refused');
      expect(paused.subtitle).toContain('Only you can resume it');
      expect(paused.icon).toBe('dialog-warning-symbolic');
      for (const reason of ['feature_disabled', 'refused'] as const) {
        const v = checkView({ kind: 'refused', reason, browsers: ['Firefox 155.0'] }, de);
        expect(v.subtitle).toContain('Firefox 155.0');
        expect(v.subtitle.includes('{')).toBe(false);
      }
    });

    await it('says so when no browser answered, and when the check could not run', async () => {
      expect(checkView({ kind: 'nobrowser' }, en).subtitle).toContain('No browser answered');
      expect(checkView({ kind: 'failed', reason: 'ports full' }, en).subtitle).toContain('ports full');
    });

    await it('has no field for a policy action: only words, an icon and the button', async () => {
      const keys = Object.keys(checkView({ kind: 'idle' }, en))
        .sort()
        .join();
      expect(keys).toBe('busy,button,icon,subtitle,title');
    });
  });
};
