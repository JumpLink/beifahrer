import { describe, expect, it } from '@gjsify/unit';

import { GECKO_ID as MANIFEST_GECKO_ID } from '../../../../extension/manifest.ts';
import {
  BROWSERS,
  CHROMIUM_STORE_IDS,
  EXTENSION_NAME,
  GECKO_ID,
  STORE_URLS,
  browserChoices,
  browserOfApp,
  browserOfName,
  browserRows,
  chromiumHasExtension,
  chromiumProfileDirs,
  detectBrowsers,
  extensionState,
  firefoxHasExtension,
  firefoxProfileDirs,
  manifestName,
  preselected,
  type BrowserId,
} from '../../../src/window/browser-model.ts';

// Shaped like the files of Chromium 149 and Firefox 150, with synthetic content.
const unpackedPrefs = JSON.stringify({
  extensions: {
    settings: {
      mhjfbmdgcfjbbpaeojofohoefgiehjai: { manifest: { name: 'Chrome PDF Viewer' }, location: 5 },
      bglpehebkpigdocoiekhalcabapbacnh: { location: 8, path: '/home/x/beifahrer/chrome-mv3' },
    },
  },
});
const manifestJson = JSON.stringify({ name: '__MSG_extName__', default_locale: 'en' });
const messages = JSON.stringify({ extName: { message: 'Beifahrer' } });

export default async () => {
  await describe('default browser', async () => {
    await it('maps application ids and executables of every platform', async () => {
      expect(browserOfApp('org.mozilla.firefox.desktop')).toBe('firefox');
      expect(browserOfApp('firefox-esr.desktop')).toBe('firefox');
      expect(browserOfApp('chromium-browser.desktop')).toBe('chromium');
      expect(browserOfApp('com.google.Chrome.desktop')).toBe('chrome');
      expect(browserOfApp('brave-browser.desktop')).toBe('brave');
      expect(browserOfApp('microsoft-edge.desktop')).toBe('edge');
      expect(browserOfApp(null, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBe(
        'edge',
      );
      expect(browserOfApp('com.apple.Safari')).toBe('safari');
      expect(browserOfApp('org.gnome.Evolution.desktop', undefined)).toBe(null);
    });

    await it('names a connected browser the way Hello does', async () => {
      expect(browserOfName('Firefox')).toBe('firefox');
      expect(browserOfName('Microsoft Edge')).toBe('edge');
      expect(browserOfName('Chrome')).toBe('chrome');
      expect(browserOfName('Epiphany')).toBe(null);
    });

    await it('lists the default first, then found, then the rest, and Safari only when there', async () => {
      const ids = (found: BrowserId[], d: BrowserId | null) => browserChoices(found, d).map((e) => e.id);
      expect(ids(['firefox', 'brave'], 'brave')).toEqualArray([
        'brave',
        'firefox',
        'chromium',
        'chrome',
        'edge',
      ]);
      expect(ids([], 'safari')[0]).toBe('safari');
      expect(ids([], null)).toEqualArray(['firefox', 'chromium', 'chrome', 'brave', 'edge']);
      const choices = browserChoices(['chrome'], 'chrome');
      expect(preselected(choices)).toBe('chrome');
      expect(preselected([])).toBe('firefox');
    });

    await it('finds installed browsers by command or file', async () => {
      const found = detectBrowsers('linux', (p) => p, {
        has: (p) => p.endsWith('com.brave.Browser'),
        onPath: (c) => c === 'firefox',
      });
      expect(found).toEqualArray(['firefox', 'brave']);
    });

    await it('knows every browser by a unique id', async () => {
      expect(new Set(BROWSERS.map((b) => b.id)).size).toBe(BROWSERS.length);
    });
  });

  await describe('extension in a profile', async () => {
    await it('pins the add-on id to the manifest', async () => {
      expect(GECKO_ID).toBe(MANIFEST_GECKO_ID);
    });

    await it('reads the profiles of a Firefox profiles.ini', async () => {
      const ini = [
        '[Install4F96D1932A9F858E]',
        'Default=Profiles/abc.default-release',
        'Locked=1',
        '',
        '[Profile1]',
        'Name=work',
        'IsRelative=0',
        'Path=/data/ff/work',
        '',
        '[Profile0]',
        'Name=default-release',
        'IsRelative=1',
        'Path=Profiles/abc.default-release',
        'Default=1',
        '',
        '[General]',
        'StartWithLastProfile=1',
      ].join('\n');
      expect(firefoxProfileDirs(ini, '/home/x/.mozilla/firefox')).toEqualArray([
        '/home/x/.mozilla/firefox/Profiles/abc.default-release',
        '/data/ff/work',
      ]);
    });

    await it('finds the add-on id in extensions.json and nothing else', async () => {
      const json = (ids: string[]) =>
        JSON.stringify({ schemaVersion: 37, addons: ids.map((id) => ({ id })) });
      expect(firefoxHasExtension(json(['x@y', GECKO_ID]))).toBe(true);
      expect(firefoxHasExtension(json(['x@y']))).toBe(false);
      expect(firefoxHasExtension('not json')).toBe(false);
      expect(firefoxHasExtension('{}')).toBe(false);
    });

    await it('takes Default and numbered profiles of a Chromium user-data folder', async () => {
      expect(
        chromiumProfileDirs(['Default', 'Profile 2', 'Profile X', 'Local State', 'Guest Profile']),
      ).toEqualArray(['Default', 'Profile 2']);
    });

    await it('resolves a placeholder name through the default locale', async () => {
      expect(manifestName(manifestJson, (l) => (l === 'en' ? messages : null))).toBe(EXTENSION_NAME);
      expect(manifestName(manifestJson, () => null)).toBe(null);
      expect(manifestName(JSON.stringify({ name: 'Other' }), () => null)).toBe('Other');
      expect(manifestName('nope', () => null)).toBe(null);
    });

    await it('finds an unpacked extension by the name in its folder', async () => {
      const at = (path: string) => (path === '/home/x/beifahrer/chrome-mv3' ? 'Beifahrer' : 'Something');
      expect(chromiumHasExtension(unpackedPrefs, at)).toBe(true);
      expect(chromiumHasExtension(unpackedPrefs, () => null)).toBe(false);
      expect(chromiumHasExtension('{}', at)).toBe(false);
      expect(chromiumHasExtension('broken', at)).toBe(false);
    });

    await it('finds a store install by its manifest name or by a known store id', async () => {
      const store = JSON.stringify({
        extensions: { settings: { abcdefgh: { manifest: { name: 'Beifahrer' } } } },
      });
      expect(chromiumHasExtension(store, () => null)).toBe(true);
      const byId = JSON.stringify({ extensions: { settings: { storeid: { location: 1 } } } });
      expect(chromiumHasExtension(byId, () => null, ['storeid'])).toBe(true);
      expect(chromiumHasExtension(byId, () => null)).toBe(false);
    });

    await it('has no store listing yet, so no store page is offered', async () => {
      expect(CHROMIUM_STORE_IDS.length).toBe(0);
      expect(Object.keys(STORE_URLS).length).toBe(0);
    });
  });

  await describe('three states', async () => {
    await it('combines what the profile says with the connection', async () => {
      expect(extensionState(true, true)).toBe('connected');
      expect(extensionState(false, true)).toBe('connected');
      expect(extensionState(null, true)).toBe('connected');
      expect(extensionState(true, false)).toBe('installed');
      expect(extensionState(false, false)).toBe('not-installed');
      expect(extensionState(null, false)).toBe('not-connected');
    });

    await it('gives one row per browser worth a line', async () => {
      const choices = browserChoices(['firefox', 'chrome'], 'chrome');
      const rows = browserRows(
        choices,
        new Map<BrowserId, boolean | null>([
          ['chrome', true],
          ['firefox', false],
          ['brave', true],
        ]),
        new Set<BrowserId>(['chrome']),
      );
      expect(rows.map((r) => `${r.id}:${r.state}:${r.isDefault}`)).toEqualArray([
        'chrome:connected:true',
        'firefox:not-installed:false',
        'brave:installed:false',
      ]);
    });
  });
};
