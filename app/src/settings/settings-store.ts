/**
 * `settings.json` in the app's config directory (the one that holds the pairing token), read by the
 * window AND the `beifahrer` command, so a range chosen in the window is the range an agent session
 * binds (ADR 0017 § 8). A flag or an environment variable still wins. Losing it costs the defaults,
 * so it needs no backup; it holds no secret and no policy.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '@beifahrer/local';

import { parseSettings, serializeSettings, type Settings } from './settings-model.ts';

const file = () => join(configDir(), 'settings.json');

export function loadSettings(): Settings {
  try {
    return parseSettings(readFileSync(file(), 'utf8'));
  } catch {
    return parseSettings(null);
  }
}

/** False when it could not be written; the caller keeps the value for the session anyway. */
export function saveSettings(s: Settings): boolean {
  try {
    mkdirSync(configDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, serializeSettings(s), { mode: 0o600 });
    renameSync(tmp, file());
    return true;
  } catch {
    return false;
  }
}
