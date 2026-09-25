/**
 * What to show the person for the `toggle-pause` keyboard shortcut: what they actually have
 * bound, not the manifest default. Rebinding it (browser settings) changes `commands.getAll()`'s
 * answer, never the manifest, and macOS spells a shortcut in glyphs, never "Alt+Shift+B" — see
 * `formatShortcut` (core) for that half.
 */

import { browser } from '@wxt-dev/browser';
import { formatShortcut } from '@beifahrer/core';
import { TOGGLE_PAUSE_SHORTCUT } from '../manifest.ts';

const COMMAND = 'toggle-pause';

async function platformOs(): Promise<string> {
  // Absent on a target that has no `runtime.getPlatformInfo` (none known today, but the pattern
  // matches every other browser feature-detection in this codebase: never throw for a tooltip).
  const os = await browser.runtime.getPlatformInfo?.().catch(() => undefined);
  return os?.os ?? '';
}

/**
 * The shortcut to show, already formatted for this platform:
 *   - bound, and `commands.getAll()` exists here: exactly what the person has, or '' if they
 *     unbound it on purpose (the caller decides what to say then, see options/main.ts);
 *   - the API does not exist on this target (`NEEDS_API`-style gap): the manifest's suggested
 *     key, as our best guess at what is bound.
 */
export async function toggleShortcut(): Promise<string> {
  const os = await platformOs();
  const commands = (browser as unknown as { commands?: typeof browser.commands }).commands;
  if (typeof commands?.getAll !== 'function') return formatShortcut(TOGGLE_PAUSE_SHORTCUT, os);
  const all = await commands.getAll().catch(() => []);
  const shortcut = all.find((c) => c.name === COMMAND)?.shortcut ?? '';
  return formatShortcut(shortcut, os);
}
