import GLib from 'gi://GLib?version=2.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';
import { parsePortRange, portsOf, statusOf, unregisteredPorts } from '@beifahrer/core';
import { pairingInfo, probePorts, readEntries, registryDir } from '@beifahrer/local';

import { createTranslate, pickLocale } from './i18n.ts';
import { viewOf } from './status-model.ts';
import { watchRegistry } from './watch.ts';
import { pairingView } from './pairing-model.ts';
import { backgroundLine, onClose } from './background-model.ts';
import { createBackgroundPortal } from './background-portal.ts';
import { installAboutAction } from './about.ts';
import { createWindow } from './window.ts';

const locale = pickLocale([...GLib.get_language_names()]);
const t = createTranslate(locale);
const dir = registryDir();
const ports = portsOf(parsePortRange(process.env.BEIFAHRER_PORT, process.env.BEIFAHRER_PORT_COUNT));

const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer',
  createWindow: (app) => {
    installAboutAction(app, t, locale);
    const ui = createWindow(app, t);
    // What the last probe found that no session announced. It is kept as ports and not as "listening",
    // so a bridge that stops between two probes does not show up as a stranger.
    let unregistered: number[] = [];
    let probing = false;
    const probe = () => {
      if (probing) return;
      probing = true;
      probePorts(ports)
        .then((listening) => {
          const sessions = statusOf(
            readEntries(dir).entries.map((e) => e.entry),
            new Date(),
          ).sessions;
          const found = unregisteredPorts(listening, sessions);
          if (found.join() !== unregistered.join()) {
            unregistered = found;
            refresh(false);
          }
        })
        .catch(() => {})
        .finally(() => {
          probing = false;
        });
    };
    const portal = createBackgroundPortal();
    // Held once the window was hidden instead of closed (ADR 0024 § 2); released again at shutdown.
    let held = false;
    let lastLine = '';
    const refresh = (probeAgain = true) => {
      const { entries, skipped } = readEntries(dir);
      const view = viewOf(
        statusOf(
          entries.map((e) => e.entry),
          new Date(),
        ),
        skipped,
        t,
        unregistered,
      );
      ui.showStatus(view);
      // Only while hidden, and only when the words changed: the portal is a D-Bus round trip.
      if (held && !ui.window.get_visible()) {
        const line = backgroundLine(view, t);
        if (line !== lastLine) {
          lastLine = line;
          portal.setStatus(line);
        }
      }
      // Every tick, because the token can be rotated or recreated from the CLI while the window is open.
      try {
        ui.showPairing(pairingView(pairingInfo(), t));
      } catch (err) {
        ui.showPairing(pairingView(err instanceof Error ? err : new Error(String(err)), t));
      }
      if (probeAgain) probe();
    };
    refresh();
    const stop = watchRegistry(dir, refresh);
    app.connect('shutdown', () => {
      if (held) app.release();
      held = false;
    });
    const hide = () => {
      if (!held) {
        app.hold();
        held = true;
      }
      ui.window.set_visible(false);
      refresh(false);
    };
    const quit = () => {
      stop();
      app.quit();
    };
    let asking = false;
    ui.window.connect('close-request', () => {
      if (asking) return true;
      // Ask at the first close only; the portal object keeps its answer for the process.
      asking = true;
      portal
        .request(ui.window, t('background.reason'))
        .then((background) => (onClose({ statusIcon: false, background }) === 'hide' ? hide() : quit()))
        .catch(quit)
        .finally(() => {
          asking = false;
        });
      return true;
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
