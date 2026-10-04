import GLib from 'gi://GLib?version=2.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';
import { statusOf } from '@beifahrer/core';
import { pairingInfo, readEntries, registryDir } from '@beifahrer/local';

import { createTranslate, pickLocale } from './i18n.ts';
import { viewOf } from './status-model.ts';
import { watchRegistry } from './watch.ts';
import { pairingView } from './pairing-model.ts';
import { createWindow } from './window.ts';

const t = createTranslate(pickLocale([...GLib.get_language_names()]));
const dir = registryDir();

const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer',
  createWindow: (app) => {
    const ui = createWindow(app, t);
    const refresh = () => {
      const { entries, skipped } = readEntries(dir);
      ui.showStatus(
        viewOf(
          statusOf(
            entries.map((e) => e.entry),
            new Date(),
          ),
          skipped,
          t,
        ),
      );
      // Every tick, because the token can be rotated or recreated from the CLI while the window is open.
      try {
        ui.showPairing(pairingView(pairingInfo(), t));
      } catch (err) {
        ui.showPairing(pairingView(err instanceof Error ? err : new Error(String(err)), t));
      }
    };
    refresh();
    const stop = watchRegistry(dir, refresh);
    ui.window.connect('close-request', () => {
      stop();
      return false;
    });
    // A smoke hook for a person or a CI run without a hand on the window: the process ends itself.
    // An environment variable and not a flag, because GApplication rejects options it does not know.
    const quitAfter = Number(process.env.BEIFAHRER_DESKTOP_QUIT_AFTER_MS);
    if (quitAfter > 0)
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, quitAfter, () => (app.quit(), GLib.SOURCE_REMOVE));
    return ui.window;
  },
});
process.exit(code);
