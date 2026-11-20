import { describe, expect, it } from '@gjsify/unit';

import { siteLanguage, siteUrl } from '../../../../extension/src/ui/site-links.ts';

export default async () => {
  await describe('siteUrl', async () => {
    await it('points a German browser at the German app page', async () => {
      expect(siteUrl('de-DE')).toBe('https://jumplink.eu/beifahrer/de/');
      expect(siteUrl('de')).toBe('https://jumplink.eu/beifahrer/de/');
    });
    await it('falls back to English for every language the site lacks', async () => {
      expect(siteLanguage('fr')).toBe('en');
      expect(siteUrl('en-US')).toBe('https://jumplink.eu/beifahrer/en/');
    });
    await it('appends a page below the language root', async () => {
      expect(siteUrl('de', 'privacy/')).toBe('https://jumplink.eu/beifahrer/de/privacy/');
    });
  });
};
