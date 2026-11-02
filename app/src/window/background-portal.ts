/**
 * The Background portal through libportal (ADR 0024 § 2, § 5), inside the Flatpak only.
 *
 * libportal is loaded lazily and inside a try: a static `import` of a namespace whose typelib is
 * missing would stop the whole window on a deb/rpm host without it. Missing typelib, no sandbox or a
 * portal that errors all read `unavailable`, which makes closing quit.
 *
 * Autostart is never requested here: it is off until the person turns it on (ADR 0024 § 4).
 */

import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

import type { BackgroundAnswer } from './background-model.ts';
import { inFlatpak } from './background-model.ts';

type Xdp = typeof import('gi://Xdp?version=1.0').default;
type XdpGtk4 = typeof import('gi://XdpGtk4?version=1.0').default;

export interface BackgroundPortal {
  /** Asks once; the answer is kept for the process, so the second close does not ask again. */
  request(window: Gtk.Window, reason: string): Promise<BackgroundAnswer>;
  /** The line GNOME shows beside the app in Background Apps. Errors are swallowed: it is decoration. */
  setStatus(text: string): void;
}

export function createBackgroundPortal(): BackgroundPortal {
  let answer: Promise<BackgroundAnswer> | null = null;
  let portal: InstanceType<Xdp['Portal']> | null = null;

  const ask = async (window: Gtk.Window, reason: string): Promise<BackgroundAnswer> => {
    if (!inFlatpak(GLib.file_test('/.flatpak-info', GLib.FileTest.EXISTS), process.env)) return 'unavailable';
    try {
      const Xdp: Xdp = (await import('gi://Xdp?version=1.0')).default;
      const XdpGtk4: XdpGtk4 = (await import('gi://XdpGtk4?version=1.0')).default;
      const p = Xdp.Portal.new();
      const parent = XdpGtk4.parent_new_gtk(window);
      const granted = await new Promise<boolean>((resolve, reject) => {
        p.request_background(parent, reason, null, Xdp.BackgroundFlags.NONE, null, (_source, result) => {
          try {
            resolve(p.request_background_finish(result));
          } catch (err) {
            reject(err);
          }
        });
      });
      portal = p;
      return granted ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  };

  return {
    request: (window, reason) => (answer ??= ask(window, reason)),
    setStatus(text) {
      try {
        const p = portal;
        p?.set_background_status(text, null, (_source, result) => {
          try {
            p.set_background_status_finish(result);
          } catch {
            // see below
          }
        });
      } catch {
        // Decoration only; a portal that refuses it must not break the window.
      }
    },
  };
}
