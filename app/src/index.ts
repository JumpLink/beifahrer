import { hideBin } from 'yargs/helpers';

import { pickMode, WINDOW_BUNDLE } from './dispatch.ts';

// One binary, two programs (ADR 0023). The window is a bundle of its own, loaded only when it is
// asked for: bundled in, the node build would pull in GTK's bindings, which keep the process alive
// after `--version` and load a toolkit the headless bridge a coding agent starts has no use for.
if (pickMode(hideBin(process.argv)) === 'window') {
  await import(new URL(WINDOW_BUNDLE, import.meta.url).href);
} else {
  await import('./cli.ts');
}
