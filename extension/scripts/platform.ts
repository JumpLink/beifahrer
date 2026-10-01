/**
 * Where this host keeps the things the dev loop and the e2e driver have to find: a Chromium that
 * still loads an unpacked extension, a Firefox, and the local `node_modules/.bin` launchers.
 *
 * One module, because the same three questions are asked from two places that cannot import each
 * other otherwise: `extension/scripts/` is bundled by gjsify onto GJS, and `tests/e2e/*.mjs` is
 * plain Node. Both read this file; a second copy of a path table is a second truth that drifts.
 *
 * Every path below is a CANDIDATE that is `existsSync`-checked, and a miss is `undefined` or a
 * fall-through — never an invented answer. What was verified where is named in the comment.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The env fields this module reads. `process.env` satisfies it; a test injects a literal. */
type Env = Record<string, string | undefined>;

const isWindows = (platform: string): boolean => platform === 'win32';

/**
 * Chromium's binary inside one `chromium-<rev>` directory of Playwright's cache, per platform.
 *
 * Linux is MEASURED on this machine (2026-10-01, `~/.cache/ms-playwright/chromium-1246`):
 * `chrome-linux64/chrome` is what is installed. The `chrome-*` alternatives of the other two
 * platforms are Playwright's documented layout and are NOT verified — no macOS or Windows host
 * was available — which is why each is a candidate to be checked rather than a path to trust.
 * Both names are listed per platform because Playwright has shipped both spellings.
 */
const CHROMIUM_BIN: Record<string, string[]> = {
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
  darwin: [
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
};

/**
 * Playwright's browser cache, which is NOT under `~/.cache` on the other two platforms.
 *
 * Linux is MEASURED; the macOS (`~/Library/Caches`) and Windows (`%LOCALAPPDATA%`) roots are
 * Playwright's documented ones and are NOT verified here.
 */
function playwrightCache(env: Env, platform: string, home: string): string {
  if (isWindows(platform)) return join(env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'ms-playwright');
  if (platform === 'darwin') return join(home, 'Library/Caches/ms-playwright');
  return join(home, '.cache/ms-playwright');
}

/**
 * A Chromium that loads unpacked extensions, or `undefined`.
 *
 * Branded Chrome ≥ 137 ignores `--load-extension`, so this must be Chrome for Testing —
 * Playwright's build is the one this repository has. Playwright is NOT a dependency here (the
 * browsers in the cache were put there by something else), so there is no installed
 * `executablePath()` to ask; the table above is the substitute, and it is why each entry is
 * checked instead of assumed.
 */
export function chromiumBinary(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string | undefined {
  if (env.BEIFAHRER_E2E_CHROMIUM) return env.BEIFAHRER_E2E_CHROMIUM;
  const base = playwrightCache(env, platform, home);
  if (!existsSync(base)) return undefined;
  // Newest revision first: lexicographic, and every directory is chromium-<digits>.
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const dir of dirs) {
    for (const rel of CHROMIUM_BIN[platform] ?? []) {
      const bin = join(base, dir, rel);
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

/**
 * Firefox's own install, before Playwright's copy: the driver drives the person's browser (the
 * dev profile is thrown away, the BINARY is not), so a real install is preferred over the
 * headless-shell build in the cache.
 *
 * Linux is the PATH lookup the suite has always used, and stays it — the Linux candidates are
 * empty, so the answer is the bare name `firefox`. The macOS and Windows entries are the standard
 * install locations and are NOT verified here; a miss falls through to the bare name, which is
 * what a PATH lookup finds anyway.
 */
export function firefoxBinary(env: Env = process.env, platform: string = process.platform): string {
  if (env.BEIFAHRER_E2E_FIREFOX) return env.BEIFAHRER_E2E_FIREFOX;
  const candidates = isWindows(platform)
    ? [
        join(env.ProgramFiles ?? 'C:\\Program Files', 'Mozilla Firefox/firefox.exe'),
        join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Mozilla Firefox/firefox.exe'),
      ]
    : platform === 'darwin'
      ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
      : [];
  for (const bin of candidates) if (existsSync(bin)) return bin;
  return 'firefox';
}
