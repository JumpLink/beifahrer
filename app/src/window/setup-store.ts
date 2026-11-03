/** The "setup finished" flag, in the `setup` section of `window.json` (ADR 0023 § 6). */

import { parseSetupDone } from './setup-state-model.ts';
import { readWindowFile, writeSection } from './window-file.ts';

export const loadSetupDone = (): boolean => parseSetupDone(readWindowFile());

export const saveSetupDone = (done: boolean): boolean => writeSection('setup', { done });
