/**
 * Where live sessions announce themselves (ADR 0015 §1).
 *
 * `$XDG_RUNTIME_DIR` where there is one (Linux: per-user, tmpfs, gone at logout), else a directory in
 * the per-user temp directory (macOS and Windows have no runtime directory, and their temp directory
 * is private to the person). The Linux fallback `/tmp` is shared, so the directory name carries the
 * user and `store.ts` refuses a directory somebody else owns.
 *
 * Env, temp directory and user name are INJECTED, so every branch is testable from one platform.
 */

import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import type { Env } from '../config-dir.ts';

/** A user name that is safe in a directory name; anything else becomes `_`. */
function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_') || 'user';
}

function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'user';
  }
}

export function registryDir(
  env: Env = process.env,
  tmp: string = tmpdir(),
  user: string = currentUser(),
): string {
  if (env.BEIFAHRER_REGISTRY_DIR) return env.BEIFAHRER_REGISTRY_DIR;
  // `||` like configDir(): an empty XDG_RUNTIME_DIR is a variable set to nothing, and taking it would
  // root the directory at the relative path `beifahrer`.
  const base = env.XDG_RUNTIME_DIR
    ? join(env.XDG_RUNTIME_DIR, 'beifahrer')
    : join(tmp, `beifahrer-${safe(user)}`);
  return join(base, 'sessions');
}
