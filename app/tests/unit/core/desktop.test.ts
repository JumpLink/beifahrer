import { describe, expect, it } from '@gjsify/unit';

import {
  DESKTOP_ACCENTS,
  chooseAccent,
  parseDesktop,
  parseDesktopAccent,
  parseWelcome,
} from '@beifahrer/core';

const welcome = { type: 'welcome', protocol: 1, bridge: { version: 't' }, connectionId: 'c1' };

export default async () => {
  await describe('parseDesktopAccent', async () => {
    await it("accepts exactly libadwaita's nine names", async () => {
      expect(DESKTOP_ACCENTS.length).toBe(9);
      for (const name of DESKTOP_ACCENTS) expect(parseDesktopAccent(name)).toBe(name);
    });

    await it('refuses anything else: colour values, other case, GSettings quoting, non-strings', async () => {
      for (const raw of [
        '#9141ac',
        'Purple',
        "'purple'",
        'rgb(0,0,0)',
        'url(x)',
        '',
        'default',
        7,
        null,
        {},
      ]) {
        expect(parseDesktopAccent(raw)).toBe(null);
      }
    });
  });

  await describe('parseDesktop', async () => {
    await it('keeps a known accent and drops unknown keys', async () => {
      const d = parseDesktop({ accent: 'teal', css: 'body{}' }) as Record<string, unknown>;
      expect(d.accent).toBe('teal');
      expect(Object.keys(d).length).toBe(1);
    });

    await it('turns junk into "nothing known"', async () => {
      for (const raw of [undefined, null, 'purple', { accent: 'magenta' }]) {
        expect(Object.keys(parseDesktop(raw)).length).toBe(0);
      }
    });
  });

  await describe('parseWelcome with a desktop', async () => {
    await it('carries a known accent', async () => {
      expect(parseWelcome({ ...welcome, desktop: { accent: 'purple' } })?.desktop?.accent).toBe('purple');
    });

    await it('still welcomes a bridge whose desktop it cannot read, without the desktop', async () => {
      const w = parseWelcome({ ...welcome, desktop: { accent: '#ff0000' } });
      expect(w?.connectionId).toBe('c1');
      expect(w?.desktop).toBeUndefined();
    });

    await it('accepts a welcome without desktop (older bridges)', async () => {
      expect(parseWelcome(welcome)?.desktop).toBeUndefined();
    });
  });

  await describe('chooseAccent', async () => {
    await it('prefers what the bridge said, even where the browser has AccentColor', async () => {
      const c = chooseAccent('purple', true);
      expect(c.from).toBe('desktop');
      expect(c.from === 'desktop' && c.name).toBe('purple');
    });

    await it("falls back on the browser's AccentColor, then on Adwaita blue", async () => {
      expect(chooseAccent(undefined, true).from).toBe('system');
      const d = chooseAccent(undefined, false);
      expect(d.from).toBe('default');
      expect(d.from === 'default' && d.name).toBe('blue');
    });

    await it('ignores a stored value that is not one of the nine names', async () => {
      expect(chooseAccent('#123456', false).from).toBe('default');
      expect(chooseAccent({ accent: 'green' }, true).from).toBe('system');
    });
  });
};
