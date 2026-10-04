/**
 * Where beifahrer keeps the person's own files: the pairing token, their recipes, nothing of the
 * repository's.
 *
 * ONE answer for the whole app, because two places that each spell it out are two answers waiting
 * to disagree — and they already did: the e2e driver fakes `$XDG_CONFIG_HOME` to keep a person's
 * real recipes out of a test run, which is only a faithful fake if the app resolves its config
 * directory the way the driver does.
 *
 * `$XDG_CONFIG_HOME` still wins when it is set, on every platform. It is the one variable that
 * exists on all three, it is what a person's `.config` really is when they moved it, and it is how
 * a test points the app somewhere else. The DEFAULT is the platform's own convention:
 *
 * | platform | directory                               | where the convention comes from  |
 * |---|---|---|
 * | linux   | `~/.config/beifahrer`                   | the XDG base directory spec      |
 * | darwin  | `~/Library/Application Support/beifahrer` | macOS per-app application support |
 * | win32   | `%APPDATA%\beifahrer`                   | Windows roaming per-app settings  |
 *
 * Only the linux row is MEASURED here (this project is developed and tested on it); the other two
 * are each platform's documented convention and are NOT verified on a real host. Both are plain
 * string joins, so nothing unverifiable hides behind them.
 *
 * It lives in the app and not in `packages/core`, because it needs `node:path` and `node:os` and
 * core is deliberately free of every `node:*` import (a gate the policy code is tested through).
 *
 * Platform, env and home are INJECTED rather than read, so every row above is unit-testable from
 * Linux instead of only on the platform it describes.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The env fields this reads. `process.env` satisfies it; a test passes a literal. */
export type Env = Record<string, string | undefined>;

export function configDir(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  // `||`, not `??`: an EMPTY XDG_CONFIG_HOME is a variable that is set to nothing, and taking it
  // would root the config directory at the relative path `beifahrer`. The `||` this replaces did the
  // same, so a Linux path stays byte-identical.
  const base =
    env.XDG_CONFIG_HOME ||
    (platform === 'win32'
      ? (env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : join(home, '.config'));
  return join(base, 'beifahrer');
}
