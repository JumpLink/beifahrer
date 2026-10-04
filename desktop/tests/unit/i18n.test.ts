import { describe, expect, it } from '@gjsify/unit';

import { CATALOGS, createTranslate, pickLocale } from '../../src/i18n.ts';

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

export default async () => {
  await describe('catalogs', async () => {
    await it('have the same keys, so no language shows a raw key', async () => {
      expect(Object.keys(CATALOGS.de).sort().join('|')).toBe(Object.keys(CATALOGS.en).sort().join('|'));
    });

    await it('use the same placeholders in every language', async () => {
      for (const key of Object.keys(CATALOGS.en)) {
        expect(placeholders(CATALOGS.de[key]!)).toBe(placeholders(CATALOGS.en[key]!));
      }
    });

    await it('leave no entry empty', async () => {
      for (const locale of ['en', 'de'] as const)
        for (const [key, text] of Object.entries(CATALOGS[locale]))
          expect(`${key}:${text.trim() === ''}`).toBe(`${key}:false`);
    });
  });

  await describe('pickLocale', async () => {
    await it("takes the first language we have, in the person's own order", async () => {
      expect(pickLocale(['fr_FR.UTF-8', 'de_DE.UTF-8', 'en_US'])).toBe('de');
      expect(pickLocale(['en-GB', 'de'])).toBe('en');
      expect(pickLocale(['de-AT'])).toBe('de');
      expect(pickLocale(['de@euro'])).toBe('de');
    });

    await it('is English when nothing matches, or only the C locale is set', async () => {
      expect(pickLocale([])).toBe('en');
      expect(pickLocale(['C', 'POSIX', 'fr'])).toBe('en');
    });
  });

  await describe('createTranslate', async () => {
    await it('fills placeholders and leaves an unknown one visible', async () => {
      const t = createTranslate('en');
      expect(t('session.port', { port: 47813 })).toBe('Port 47813');
      expect(t('session.port')).toBe('Port {port}');
    });

    await it('speaks German when asked', async () => {
      expect(createTranslate('de')('status.ready.title')).toBe('Bereit');
    });
  });
};
