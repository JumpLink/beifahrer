import { describe, expect, it } from '@gjsify/unit';

import { browserFromUserAgent } from '@beifahrer/core';

/**
 * `@gjsify/unit`'s `toEqual` cannot deep-compare a plain object on GJS — it reports identical
 * objects as unequal — so an exact object comparison goes through its JSON, and arrays through
 * `toEqualArray`, which is what the rest of this suite tree uses.
 */
const sameJson = (actual: unknown, expected: unknown): void => {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
};

// Real user agents, as the browsers send them. The Chromium ones all carry `Chrome/` and say
// `Safari/`, so each is only identifiable by its brands — which is the whole reason the family is
// read rather than derived.
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/17.0 Safari/605.1.15';
// Both tokens at once is the ordering hazard this function has to survive: if a future WebKit-based
// browser ships a Chrome-compatible UA, Epiphany's own check must still come first.
const EPIPHANY_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36 Epiphany/45.0';

// Chromium's `userAgentData` carries the browser's own entry plus two that name nobody: the GREASE
// entries (which change name per build — "Not/A)Brand" here) and the generic "Chromium".
const brands = (browser: string) => [
  { brand: 'Not/A)Brand', version: '8' },
  { brand: 'Chromium', version: '140' },
  { brand: browser, version: '140' },
];

export default async () => {
  await describe('browserFromUserAgent', async () => {
    // Edge ships the `edge-mv3` build, but a build target is not a wire value: the family stays
    // `chromium` and the NAME is what tells a person — and an agent passing `browser:` — which
    // browser this is. A family per brand would have changed no decision anywhere.
    await it('answers Edge as a chromium named Microsoft Edge', async () => {
      sameJson(browserFromUserAgent(EDGE_UA, brands('Microsoft Edge')), {
        family: 'chromium',
        name: 'Microsoft Edge',
        version: '140',
      });
    });

    await it('reads the brand, not the Chrome token — Chrome and Brave are told apart the same way', async () => {
      expect(browserFromUserAgent(CHROME_UA, brands('Google Chrome')).name).toBe('Google Chrome');
      expect(browserFromUserAgent(CHROME_UA, brands('Brave')).name).toBe('Brave');
    });

    await it('falls back to the Chromium brand, then to the Chrome/ token, when no brand is named', async () => {
      const greased = [
        { brand: 'Not?A?Brand', version: '8' },
        { brand: 'Chromium', version: '140' },
      ];
      expect(browserFromUserAgent(CHROME_UA, greased).name).toBe('Chromium');
      // No `userAgentData` at all: the token is all there is.
      expect(browserFromUserAgent(CHROME_UA).name).toBe('Chromium');
      expect(browserFromUserAgent(CHROME_UA).version).toBe('140.0.0.0');
    });

    await it('does NOT answer firefox — that needs the extension API, which only Firefox has', async () => {
      // A fact about this function, not a gap in it: `browserInfo()` (extension/src/browser-info.ts)
      // asks `runtime.getBrowserInfo` first and never reaches here on Firefox. Asserted so that
      // moving that check down into this function would be a visible change.
      expect(browserFromUserAgent(FIREFOX_UA).family).toBe('unknown');
    });

    await it('tells Safari from Chromium, though both say Safari/', async () => {
      expect(browserFromUserAgent(SAFARI_UA).family).toBe('safari');
      expect(browserFromUserAgent(SAFARI_UA).version).toBe('17.0');
    });

    await it('answers Epiphany before Chromium, though it says Chrome/ and Safari/ too', async () => {
      expect(browserFromUserAgent(EPIPHANY_UA).family).toBe('epiphany');
      expect(browserFromUserAgent(EPIPHANY_UA).version).toBe('45.0');
    });

    await it('answers unknown rather than guessing', async () => {
      expect(browserFromUserAgent('').family).toBe('unknown');
      expect(browserFromUserAgent('curl/8.5.0').family).toBe('unknown');
      expect(browserFromUserAgent('curl/8.5.0').name).toBe('unknown');
    });
  });
};
