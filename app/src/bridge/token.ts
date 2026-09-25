/**
 * The pairing token: a random secret the bridge keeps in the person's config directory and the
 * person pastes into the extension once.
 *
 * It lives OUTSIDE the repository, in `$XDG_CONFIG_HOME/beifahrer/token`, readable by the owner
 * only. It is not a credential for anything else — losing it costs one re-pairing (`beifahrer
 * token --rotate`) — so it is regenerable, not precious.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function tokenPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BEIFAHRER_TOKEN_FILE) return env.BEIFAHRER_TOKEN_FILE;
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'beifahrer', 'token');
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
