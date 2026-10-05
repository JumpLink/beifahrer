import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectToken, otherTokenPath, pairingInfo } from '@beifahrer/local';

function withHome(run: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'beifahrer-pairing-'));
  try {
    run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${text}\n`);
};

// A browser is paired with ONE token, and a second token file on the same machine is exactly the
// kind of thing that reads as "not connected" and nothing more.
export default async () => {
  await describe('otherTokenPath', async () => {
    await it('is the XDG default on the platforms whose own convention is elsewhere', async () => {
      expect(otherTokenPath({}, 'darwin', '/Users/p')).toBe('/Users/p/.config/beifahrer/token');
      expect(otherTokenPath({}, 'win32', 'C:\\Users\\p')).toMatch(/\.config.beifahrer.token$/);
    });

    await it('is nothing on Linux, where that IS the convention, or when the person pointed elsewhere', async () => {
      expect(otherTokenPath({}, 'linux', '/home/p')).toBe(null);
      expect(otherTokenPath({ XDG_CONFIG_HOME: '/x' }, 'darwin', '/Users/p')).toBe(null);
      expect(otherTokenPath({ BEIFAHRER_TOKEN_FILE: '/t' }, 'darwin', '/Users/p')).toBe(null);
    });
  });

  await describe('pairingInfo', async () => {
    await it('creates the token on first use and says where it is', async () => {
      withHome((home) => {
        const env = { BEIFAHRER_TOKEN_FILE: join(home, 'cfg', 'token') };
        const first = pairingInfo(env, 'linux', home);
        expect(first.token.length > 20).toBe(true);
        expect(first.path).toBe(env.BEIFAHRER_TOKEN_FILE);
        expect(first.other).toBe(null);
        expect(pairingInfo(env, 'linux', home).token).toBe(first.token);
      });
    });

    await it('names a second token file that holds a DIFFERENT token, and never its content', async () => {
      withHome((home) => {
        // darwin: the convention is ~/Library/Application Support, the other is ~/.config.
        put(join(home, 'Library', 'Application Support', 'beifahrer', 'token'), 'current-token-aaaaaaaaaaaa');
        put(join(home, '.config', 'beifahrer', 'token'), 'older-token-bbbbbbbbbbbbbbbbb');
        const info = pairingInfo({}, 'darwin', home);
        expect(info.token).toBe('current-token-aaaaaaaaaaaa');
        expect(info.other).toBe(join(home, '.config', 'beifahrer', 'token'));
        expect(JSON.stringify(info)).not.toMatch(/older-token/);
      });
    });

    await it('stays quiet when the second file holds the same token, or there is none', async () => {
      withHome((home) => {
        put(join(home, 'Library', 'Application Support', 'beifahrer', 'token'), 'same-token-cccccccccccccc');
        expect(pairingInfo({}, 'darwin', home).other).toBe(null);
        put(join(home, '.config', 'beifahrer', 'token'), 'same-token-cccccccccccccc');
        expect(pairingInfo({}, 'darwin', home).other).toBe(null);
      });
    });
  });

  await describe('inspectToken', async () => {
    await it('creates NOTHING: a diagnosis must not change what it diagnoses', async () => {
      withHome((home) => {
        const env = { BEIFAHRER_TOKEN_FILE: join(home, 'cfg', 'token') };
        const state = inspectToken(env, 'linux', home);
        expect(state.exists).toBe(false);
        expect(state.path).toBe(env.BEIFAHRER_TOKEN_FILE);
        expect(existsSync(join(home, 'cfg'))).toBe(false);
      });
    });

    await it('sees a token, and an empty file is none', async () => {
      withHome((home) => {
        const path = join(home, 'cfg', 'token');
        put(path, 'a-token-aaaaaaaaaaaaaaaa');
        expect(inspectToken({ BEIFAHRER_TOKEN_FILE: path }, 'linux', home).exists).toBe(true);
        put(path, '');
        expect(inspectToken({ BEIFAHRER_TOKEN_FILE: path }, 'linux', home).exists).toBe(false);
      });
    });

    await it('names a second token file with a different token, like pairingInfo, and not its content', async () => {
      withHome((home) => {
        put(join(home, 'Library', 'Application Support', 'beifahrer', 'token'), 'current-token-aaaaaaaaaaaa');
        put(join(home, '.config', 'beifahrer', 'token'), 'older-token-bbbbbbbbbbbbbbbbb');
        const state = inspectToken({}, 'darwin', home);
        expect(state.other).toBe(join(home, '.config', 'beifahrer', 'token'));
        expect(JSON.stringify(state)).not.toMatch(/older-token/);
      });
    });
  });
};
