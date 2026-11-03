/**
 * `window.json` in the app's config directory (the one that holds the pairing token): the window's own
 * small settings, shared by sections (`autostart`, `setup`). Losing it costs one more question and one
 * more run of the assistant, so it needs no backup. Sections are merged, never overwritten whole.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '@beifahrer/local';

import { mergeSection } from './setup-state-model.ts';

const file = () => join(configDir(), 'window.json');

export function readWindowFile(): string | null {
  try {
    return readFileSync(file(), 'utf8');
  } catch {
    return null;
  }
}

/** False when it could not be written; the caller keeps the value for the session anyway. */
export function writeSection(key: string, value: unknown): boolean {
  try {
    mkdirSync(configDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, mergeSection(readWindowFile(), key, value), { mode: 0o600 });
    renameSync(tmp, file());
    return true;
  } catch {
    return false;
  }
}
