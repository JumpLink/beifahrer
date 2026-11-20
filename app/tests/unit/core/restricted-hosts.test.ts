import { describe, expect, it } from '@gjsify/unit';

import { FIREFOX_RESTRICTED_HOSTS, isRestrictedUrl } from '@beifahrer/core';

export default async () => {
  await describe('isRestrictedUrl', async () => {
    await it('closes every default Firefox host, on its exact hostname', async () => {
      for (const host of FIREFOX_RESTRICTED_HOSTS)
        expect(isRestrictedUrl('firefox', `https://${host}/some/path?x=1`)).toBe(true);
      expect(FIREFOX_RESTRICTED_HOSTS.length).toBe(12);
    });

    await it('does not treat a subdomain or a lookalike of a Firefox host as closed', async () => {
      expect(isRestrictedUrl('firefox', 'https://evil.addons.mozilla.org/')).toBe(false);
      expect(isRestrictedUrl('firefox', 'https://addons.mozilla.org.example/')).toBe(false);
      expect(isRestrictedUrl('firefox', 'https://mozilla.org/')).toBe(false);
      expect(isRestrictedUrl('firefox', 'https://www.mozilla.org/')).toBe(false);
    });

    await it('reads case and a trailing dot as the same host', async () => {
      expect(isRestrictedUrl('firefox', 'https://ADDONS.Mozilla.org/')).toBe(true);
      expect(isRestrictedUrl('firefox', 'https://addons.mozilla.org./')).toBe(true);
    });

    await it('closes the Chromium stores, by host or by path', async () => {
      expect(isRestrictedUrl('chromium', 'https://chromewebstore.google.com/detail/x')).toBe(true);
      expect(isRestrictedUrl('chromium', 'https://chrome.google.com/webstore')).toBe(true);
      expect(isRestrictedUrl('chromium', 'https://chrome.google.com/webstore/detail/x')).toBe(true);
      expect(isRestrictedUrl('chromium', 'https://chrome.google.com/webstorefront')).toBe(false);
      expect(isRestrictedUrl('chromium', 'https://chrome.google.com/')).toBe(false);
      expect(isRestrictedUrl('chromium', 'https://microsoftedge.microsoft.com/addons/detail/x')).toBe(true);
      expect(isRestrictedUrl('chromium', 'https://microsoftedge.microsoft.com/')).toBe(false);
    });

    await it('keeps the families apart', async () => {
      expect(isRestrictedUrl('chromium', 'https://addons.mozilla.org/')).toBe(false);
      expect(isRestrictedUrl('firefox', 'https://chromewebstore.google.com/')).toBe(false);
    });

    await it('answers false without a family, a URL or a web URL', async () => {
      expect(isRestrictedUrl(undefined, 'https://addons.mozilla.org/')).toBe(false);
      expect(isRestrictedUrl('safari', 'https://addons.mozilla.org/')).toBe(false);
      expect(isRestrictedUrl('firefox', null)).toBe(false);
      expect(isRestrictedUrl('firefox', 'not a url')).toBe(false);
      expect(isRestrictedUrl('firefox', 'about:addons')).toBe(false);
    });
  });
};
