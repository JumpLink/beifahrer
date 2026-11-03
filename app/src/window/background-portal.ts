/**
 * The Background portal through libportal (ADR 0024 § 2, § 4, § 5), inside the Flatpak only.
 *
 * libportal is loaded lazily and inside a try: a static `import` of a namespace whose typelib is
 * missing would stop the whole window on a deb/rpm host without it. Missing typelib, no sandbox or a
 * portal that errors all read `unavailable`, which makes closing quit.
 *
 * The portal treats every request as the complete wish: a request WITHOUT the autostart flag removes
 * the autostart entry. So every call here says whether autostart is wanted, never just "background".
 */

import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

import { autostartCommandline } from './autostart-model.ts';
import type { BackgroundAnswer } from './background-model.ts';
import { inFlatpak } from './background-model.ts';

type Xdp = typeof import('gi://Xdp?version=1.0').default;
type XdpGtk4 = typeof import('gi://XdpGtk4?version=1.0').default;

export interface BackgroundPortal {
  /** Asks once at the first close; the answer is kept for the process, so the second close does not ask. */
  request(window: Gtk.Window, reason: string): Promise<BackgroundAnswer>;
  /** Turns autostart on or off with a fresh request; off removes the entry completely (ADR 0024 § 4). */
  setAutostart(window: Gtk.Window, reason: string, enabled: boolean): Promise<BackgroundAnswer>;
  /** The line GNOME shows beside the app in Background Apps. Errors are swallowed: it is decoration. */
  setStatus(text: string): void;
}

/** `wantsAutostart` is read at every request, so a close after the switch was turned on keeps it on. */
export function createBackgroundPortal(wantsAutostart: () => boolean = () => false): BackgroundPortal {
  let answer: Promise<BackgroundAnswer> | null = null;
  let loaded: Promise<{ Xdp: Xdp; XdpGtk4: XdpGtk4; portal: InstanceType<Xdp['Portal']> }> | null = null;
  const load = () =>
    (loaded ??= (async () => {
      const Xdp: Xdp = (await import('gi://Xdp?version=1.0')).default;
      const XdpGtk4: XdpGtk4 = (await import('gi://XdpGtk4?version=1.0')).default;
      return { Xdp, XdpGtk4, portal: Xdp.Portal.new() };
    })());

  const ask = async (window: Gtk.Window, reason: string, autostart: boolean): Promise<BackgroundAnswer> => {
    if (!inFlatpak(GLib.file_test('/.flatpak-info', GLib.FileTest.EXISTS), process.env)) return 'unavailable';
    try {
      const { Xdp, XdpGtk4, portal } = await load();
      const parent = XdpGtk4.parent_new_gtk(window);
      const granted = await new Promise<boolean>((resolve, reject) => {
        portal.request_background(
          parent,
          reason,
          autostart ? autostartCommandline() : null,
          autostart ? Xdp.BackgroundFlags.AUTOSTART : Xdp.BackgroundFlags.NONE,
          null,
          (_source, result) => {
            try {
              resolve(portal.request_background_finish(result));
            } catch (err) {
              reject(err);
            }
          },
        );
      });
      return granted ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  };

  return {
    request: (window, reason) => (answer ??= ask(window, reason, wantsAutostart())),
    setAutostart(window, reason, enabled) {
      return (answer = ask(window, reason, enabled));
    },
    setStatus(text) {
      // No request first: a window started hidden at login has asked nothing yet and still has a line.
      load()
        .then(({ portal }) =>
          portal.set_background_status(text, null, (_source, result) => {
            try {
              portal.set_background_status_finish(result);
            } catch {
              // Decoration only.
            }
          }),
        )
        .catch(() => {});
    },
  };
}
