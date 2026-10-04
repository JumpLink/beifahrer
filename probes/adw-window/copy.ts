// S4: does the Browser page's copy button put the token on the system clipboard, on GJS and node-gi?
// Run it with a DUMMY token (XDG_CONFIG_HOME pointing at a scratch directory); it overwrites the clipboard.
import GLib from 'gi://GLib?version=2.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';

import { createTranslate } from '../../desktop/src/i18n.ts';
import { pairingView } from '../../desktop/src/pairing-model.ts';
import { createWindow } from '../../desktop/src/window.ts';

const t = createTranslate('en');
const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer.Probe',
  createWindow: (app) => {
    const ui = createWindow(app, t);
    ui.showPairing(pairingView({ token: 'dummy-token-for-the-copy-probe', path: '/scratch/token', other: null }, t));
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      console.log(`[copy] copyToken() -> ${ui.copyToken()}`);
      return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => (app.quit(), GLib.SOURCE_REMOVE));
    return ui.window;
  },
});
process.exit(code);
