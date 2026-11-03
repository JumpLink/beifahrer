/**
 * The autostart section of `window.json` (see `window-file.ts`). It stores whether the person turned
 * autostart on and whether they were asked; losing it costs one more question, so it needs no backup.
 */

import { type AutostartState, OFF, parseState } from './autostart-model.ts';
import { readWindowFile, writeSection } from './window-file.ts';

export function loadAutostart(): AutostartState {
  const text = readWindowFile();
  return text === null ? OFF : parseState(text);
}

/** False when it could not be written; the caller keeps the state for the session anyway. */
export function saveAutostart(state: AutostartState): boolean {
  return writeSection('autostart', { enabled: state.enabled, asked: state.asked });
}
