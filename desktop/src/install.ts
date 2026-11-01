/**
 * Where the bridge is installed, for the "Connect an agent" page. The window is a different program
 * from the bridge, so it cannot ask its own process: it looks in the places the packages put the
 * bridge (gjsify `ship` layout). `null` means none of them holds it; the page then says so.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Install } from '@beifahrer/core';

type Env = Record<string, string | undefined>;

export function launcherCandidates(
  platform: string,
  env: Env = process.env,
  home: string = homedir(),
): string[] {
  if (platform === 'darwin') {
    const rel = 'Beifahrer.app/Contents/MacOS/beifahrer';
    return [`/Applications/${rel}`, join(home, 'Applications', rel)];
  }
  if (platform === 'win32') {
    const dirs = [
      env['ProgramFiles'],
      env['ProgramW6432'],
      env['LOCALAPPDATA'] && join(env['LOCALAPPDATA'], 'Programs'),
    ];
    return [...new Set(dirs.filter((d): d is string => Boolean(d)))].map(
      (d) => `${d}\\Beifahrer\\beifahrer.exe`,
    );
  }
  return [];
}

export function detectInstall(
  platform: string = process.platform,
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): Install {
  const flatpak = exists('/.flatpak-info') || Boolean(env['FLATPAK_ID']);
  const candidates = launcherCandidates(platform, env);
  // Linux (deb/rpm) puts `beifahrer` on PATH, so there is nothing to look for there.
  if (candidates.length === 0) return { platform, flatpak };
  return { platform, flatpak, launcher: candidates.find(exists) ?? null };
}
