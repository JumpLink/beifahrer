import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import system from 'system';
import { AdwaitaApp, runApplication } from '@gjsify/adwaita-app';
import { parsePortRange, portsOf, statusOf, unregisteredPorts } from '@beifahrer/core';
import { pairingInfo, probePorts, readEntries, registryDir } from '@beifahrer/local';

import { createTranslate, pickLocale } from './i18n.ts';
import { viewOf } from './status-model.ts';
import { watchRegistry } from './watch.ts';
import { pairingView } from './pairing-model.ts';
import { backgroundLine, inFlatpak, onClose } from './background-model.ts';
import {
  afterAnswer,
  autostartBackend,
  shouldAsk,
  showSwitch,
  startsHidden,
  withoutFlag,
} from './autostart-model.ts';
import { askAutostart, showPreferences } from './autostart-page.ts';
import { loadAutostart, saveAutostart } from './autostart-store.ts';
import { createBackgroundPortal } from './background-portal.ts';
import { installAboutAction } from './about.ts';
import { createWindow } from './window.ts';

const locale = pickLocale([...GLib.get_language_names()]);
const t = createTranslate(locale);
const dir = registryDir();
const ports = portsOf(parsePortRange(process.env.BEIFAHRER_PORT, process.env.BEIFAHRER_PORT_COUNT));

// The autostart entry starts the window with a flag GApplication does not know, so it is taken out here.
const { requested: hiddenRequested, rest: args } = withoutFlag(system.programArgs);
const backend = autostartBackend(
  inFlatpak(GLib.file_test('/.flatpak-info', GLib.FileTest.EXISTS), process.env),
  process.platform,
);
let autostart = loadAutostart();
const hiddenStart = startsHidden(hiddenRequested, backend, autostart);

const application = new AdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer',
  createWindow: (app) => {
    installAboutAction(app, t, locale);
    const ui = createWindow(app, t, showSwitch(backend));
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
    const portal = createBackgroundPortal(() => autostart.enabled);
    // Held once the window was hidden instead of closed (ADR 0024 § 2); released again at shutdown.
    // A start from the autostart entry is hidden from the first moment, so it holds at once.
    let held = false;
    if (hiddenStart) {
      app.hold();
      held = true;
      // The application presents the window right after this function returns; the first call is skipped.
      const present = ui.window.present.bind(ui.window);
      let skip = true;
      ui.window.present = () => (skip ? void (skip = false) : present());
    }
    let questioning = false;
    const askOnce = (paired: boolean) => {
      if (questioning || !ui.window.get_visible() || !shouldAsk(backend, autostart, paired)) return;
      questioning = true;
      askAutostart(ui.window, t)
        .then(async (yes) => {
          const state = yes ? await setAutostart(true) : afterAnswer(false, false);
          // Asked is stored either way: a refusal by the system is not a reason to ask again.
          autostart = state;
          saveAutostart(state);
          if (yes && !state.enabled) ui.toast(t('autostart.failed'));
        })
        .catch(() => {})
        .finally(() => {
          questioning = false;
        });
    };
    // True when the portal put the new value in force; the portal's answer, not the wish, is stored.
    const setAutostart = async (on: boolean) => {
      const answer = await portal.setAutostart(ui.window, t('autostart.reason'), on);
      return afterAnswer(on, answer === 'granted');
    };
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
      // A browser that really connected is the proof the pairing worked, whichever way it was done.
      askOnce(view.presence === 'ready');
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
    if (showSwitch(backend)) {
      const action = new Gio.SimpleAction({ name: 'preferences' });
      action.connect('activate', () =>
        showPreferences(
          ui.window,
          t,
          autostart.enabled,
          async (on) => {
            const state = await setAutostart(on);
            // Turning it off always counts as done; turning it on only when the portal granted it.
            const ok = on ? state.enabled : true;
            if (ok) {
              autostart = { ...state, asked: true };
              saveAutostart(autostart);
            }
            return ok;
          },
          ui.toast,
        ),
      );
      app.add_action(action);
      app.set_accels_for_action('app.preferences', ['<primary>comma']);
    }
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
const code = await runApplication(application, [system.programInvocationName, ...args]);
process.exit(code);
