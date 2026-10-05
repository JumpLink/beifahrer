/**
 * The pairing token: a random secret the bridge keeps in the person's config directory and the
 * person pastes into the extension once.
 *
 * It lives OUTSIDE the repository, in the person's config directory (`$XDG_CONFIG_HOME/beifahrer`
 * when that is set, else the platform's own convention — `configDir()` in ./config-dir.ts),
 * readable by the owner only. It is not a credential for anything else — losing it costs one
 * re-pairing (`beifahrer token --rotate`) — so it is regenerable, not precious.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { configDir, type Env } from './config-dir.ts';

export function tokenPath(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (env.BEIFAHRER_TOKEN_FILE) return env.BEIFAHRER_TOKEN_FILE;
  return join(configDir(env, platform, home), 'token');
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function writeToken(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; an existing file keeps whatever it had.
  chmodSync(path, 0o600);
}

/** Read the token, creating one on first use. */
export function loadOrCreateToken(path: string = tokenPath()): { token: string; created: boolean } {
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim();
    if (token) return { token, created: false };
  }
  const token = newToken();
  writeToken(path, token);
  return { token, created: true };
}

/**
 * Where an OLDER or differently configured Beifahrer may have kept the token: `~/.config/beifahrer/token`,
 * on the platforms whose own convention is elsewhere (`configDir()`), when `$XDG_CONFIG_HOME` does
 * not already say it. A browser paired with the token in that file cannot reach a bridge that reads the
 * other one, and nothing says so but "not connected".
 */
export function otherTokenPath(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string | null {
  if (env.BEIFAHRER_TOKEN_FILE || env.XDG_CONFIG_HOME || platform === 'linux') return null;
  return join(home, '.config', 'beifahrer', 'token');
}

export interface PairingInfo {
  /** The token to paste into the extension: the one a bridge started now would use. */
  token: string;
  path: string;
  /** Another token file with a DIFFERENT token (never its content), or null. */
  other: string | null;
}

/** The second token file, if it holds a token other than `token`. Never returns or logs a content. */
function differingOther(otherPath: string | null, path: string, token: string): string | null {
  try {
    if (otherPath && otherPath !== path && existsSync(otherPath)) {
      const theirs = readFileSync(otherPath, 'utf8').trim();
      if (theirs && theirs !== token) return otherPath;
    }
  } catch {
    // An unreadable second file is not the pairing's problem.
  }
  return null;
}

/** What a person needs to pair a browser. Creates the token on first use, like `beifahrer token`. */
export function pairingInfo(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): PairingInfo {
  const path = tokenPath(env, platform, home);
  const { token } = loadOrCreateToken(path);
  return { token, path, other: differingOther(otherTokenPath(env, platform, home), path, token) };
}

export interface TokenState {
  path: string;
  /** A non-empty token is in the file. `doctor` looks and does not create one. */
  exists: boolean;
  other: string | null;
}

/** Like `pairingInfo`, but read-only: a diagnosis must not change what it diagnoses. */
export function inspectToken(
  env: Env = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): TokenState {
  const path = tokenPath(env, platform, home);
  let token = '';
  try {
    if (existsSync(path)) token = readFileSync(path, 'utf8').trim();
  } catch {
    // Unreadable counts as not there: a bridge could not use it either.
  }
  return {
    path,
    exists: token !== '',
    other: token ? differingOther(otherTokenPath(env, platform, home), path, token) : null,
  };
}
