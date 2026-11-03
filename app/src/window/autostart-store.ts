/**
 * The window's own small settings file, `window.json` in the app's config directory (the one that
 * holds the pairing token). It stores whether the person turned autostart on and whether they were
 * asked; losing it costs one more question, so it needs no backup.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '@beifahrer/local';

import { type AutostartState, OFF, parseState, serializeState } from './autostart-model.ts';

const file = () => join(configDir(), 'window.json');

export function loadAutostart(): AutostartState {
  try {
    return parseState(readFileSync(file(), 'utf8'));
  } catch {
    return OFF;
  }
}

/** False when it could not be written; the caller keeps the state for the session anyway. */
export function saveAutostart(state: AutostartState): boolean {
  try {
    mkdirSync(configDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, serializeState(state), { mode: 0o600 });
    renameSync(tmp, file());
    return true;
  } catch {
    return false;
  }
}
