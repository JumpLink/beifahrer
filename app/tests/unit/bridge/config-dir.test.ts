import { describe, expect, it } from '@gjsify/unit';
import { join } from 'node:path';

import { configDir } from '../../../src/config-dir.ts';

const HOME = '/home/person';

export default async () => {
  await describe('configDir', async () => {
    // Platform and home are INJECTED, never read: the darwin and win32 rows are claims about hosts
    // this suite has never run on, and reading `process.platform` would only ever check linux.
    await it('linux keeps XDG, and ~/.config without it', async () => {
      expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'linux', HOME)).toBe('/xdg/beifahrer');
      expect(configDir({}, 'linux', HOME)).toBe(`${HOME}/.config/beifahrer`);
    });

    await it('darwin uses Application Support, and XDG still wins', async () => {
      expect(configDir({}, 'darwin', HOME)).toBe(`${HOME}/Library/Application Support/beifahrer`);
      expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'darwin', HOME)).toBe('/xdg/beifahrer');
    });

    await it('win32 uses %APPDATA%, falling back to the documented default', async () => {
      expect(configDir({ APPDATA: 'C:\\Users\\p\\AppData\\Roaming' }, 'win32', 'C:\\Users\\p')).toBe(
        join('C:\\Users\\p\\AppData\\Roaming', 'beifahrer'),
      );
      expect(configDir({}, 'win32', 'C:\\Users\\p')).toBe(
        join('C:\\Users\\p', 'AppData', 'Roaming', 'beifahrer'),
      );
      expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'win32', 'C:\\Users\\p')).toBe('/xdg/beifahrer');
    });

    // An e2e run points the app at a throw-away profile through this one variable; if any platform
    // stopped honouring it, a person's own recipes would join the run silently.
    await it('XDG_CONFIG_HOME wins on every platform (what the e2e fake relies on)', async () => {
      for (const platform of ['linux', 'darwin', 'win32'])
        expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, platform, HOME)).toBe('/xdg/beifahrer');
    });

    await it('an empty XDG_CONFIG_HOME falls back, rather than rooting the config at /', async () => {
      // `XDG_CONFIG_HOME=''` is what an unset variable serialises to in some environments; the old
      // `env.XDG_CONFIG_HOME || homedir()/.config` treated it as unset, and this must too.
      expect(configDir({ XDG_CONFIG_HOME: '' }, 'linux', HOME)).toBe(`${HOME}/.config/beifahrer`);
    });
  });
};
