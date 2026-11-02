/**
 * What the one `beifahrer` binary does for the arguments it got (ADR 0023): no arguments means a
 * person opened it (double-click, launcher, `flatpak run`), so it shows the window; any argument
 * means a coding agent or a terminal, so it stays the headless CLI. Pure, so a test can pin it
 * without a display: the window pulls in GTK, which the bridge must never load.
 */

export type Mode = 'window' | 'cli';

/** `args` without the interpreter and the script, as yargs' `hideBin` returns them. */
export function pickMode(args: readonly string[]): Mode {
  if (args.length === 0) return 'window';
  // An explicit spelling for a terminal, for a person who wants the window from the command line.
  if (args.length === 1 && args[0] === 'window') return 'window';
  return 'cli';
}

/** The window's bundle, beside the running one: each runtime's directory holds `beifahrer.mjs` and this. */
export const WINDOW_BUNDLE = './window.mjs';
