/**
 * The desktop's accent colour, read where the bridge runs and passed to the extension, so the
 * extension's pages can follow GNOME's accent in every browser (core `desktop.ts`).
 *
 * On GJS it is GSettings `org.gnome.desktop.interface accent-color` (GNOME 47+), watched for
 * changes. Anywhere else (Node, which runs the unit tests; a desktop without that schema or key)
 * there is no source, and the welcome carries no accent: the extension then falls back on its own.
 */

import { parseDesktop, type DesktopInfo } from '@beifahrer/core';

/** Where the raw setting comes from. A fake in the tests, GSettings on GNOME. */
export interface AccentSource {
  /** The setting's current value, unparsed. */
  read(): string | null;
  /** Call `changed` whenever the value may have changed. Returns the unsubscribe. */
  watch(changed: () => void): () => void;
}

const SCHEMA = 'org.gnome.desktop.interface';
const KEY = 'accent-color';

/** The bits of GJS's Gio this file uses. Typed by hand: the app does not depend on @girs. */
interface GioLike {
  SettingsSchemaSource: {
    get_default(): {
      lookup(id: string, recursive: boolean): { has_key(key: string): boolean } | null;
    } | null;
  };
  Settings: new (props: { schema_id: string }) => {
    get_string(key: string): string;
    connect(signal: string, cb: () => void): number;
    disconnect(id: number): void;
  };
}

/**
 * GSettings on GJS, or null where there is no GJS, no such schema or no such key (GNOME < 47).
 * Looked up in the schema source first: `new Gio.Settings` on a missing schema aborts the process.
 */
export function gnomeAccentSource(): AccentSource | null {
  // `imports.gi` rather than `import 'gi://Gio'`: the same bundle source also runs the tests on
  // Node, where a gi:// module cannot be resolved at all.
  const Gio = (globalThis as { imports?: { gi?: { Gio?: GioLike } } }).imports?.gi?.Gio;
  if (!Gio?.SettingsSchemaSource.get_default()?.lookup(SCHEMA, true)?.has_key(KEY)) return null;
  const settings = new Gio.Settings({ schema_id: SCHEMA });
  return {
    read: () => settings.get_string(KEY),
    watch(changed) {
      const id = settings.connect(`changed::${KEY}`, changed);
      return () => settings.disconnect(id);
    },
  };
}

/** A value that never changes: what `BEIFAHRER_DESKTOP_ACCENT` sets, for tests only. */
export function fixedAccentSource(value: string): AccentSource {
  return { read: () => value, watch: () => () => undefined };
}

/**
 * Whether this process runs in a GNOME session, read from `XDG_CURRENT_DESKTOP` (a colon list:
 * `GNOME`, `ubuntu:GNOME`, `GNOME-Classic:GNOME`).
 *
 * Having the schema is not enough. Homebrew installs `gsettings-desktop-schemas` on macOS, and KDE
 * or Xfce hosts carry it too, so GSettings answers there with the schema's DEFAULT, `'blue'`, not
 * a setting anybody made. Measured on macOS 27 with the system accent set to purple: `gsettings get
 * org.gnome.desktop.interface accent-color` said `'blue'`, the bridge sent it, and the extension
 * painted blue over Firefox's `AccentColor`, which was purple.
 */
export function isGnomeSession(env: Record<string, string | undefined>): boolean {
  return (env.XDG_CURRENT_DESKTOP ?? '').split(':').some((d) => /^GNOME/i.test(d.trim()));
}

/**
 * This process's source. `BEIFAHRER_DESKTOP_ACCENT` is a TEST-ONLY override (the e2e sets it so
 * that its result does not depend on the machine's desktop); otherwise GSettings, in a GNOME session.
 * Everywhere else there is none, and the extension follows the browser's `AccentColor`.
 */
export function desktopSource(env: Record<string, string | undefined> = process.env): AccentSource | null {
  const forced = env.BEIFAHRER_DESKTOP_ACCENT;
  if (forced) return fixedAccentSource(forced);
  return isGnomeSession(env) ? gnomeAccentSource() : null;
}

export function readDesktop(source: AccentSource | null): DesktopInfo {
  return source ? parseDesktop({ accent: source.read() }) : {};
}

/**
 * Push the desktop to `target` now and on every change. Returns the unsubscribe; the caller must
 * hold it (on GJS it also keeps the Gio.Settings object, and with it the signal, alive).
 */
export function followDesktop(
  source: AccentSource | null,
  target: (desktop: DesktopInfo) => void,
): () => void {
  target(readDesktop(source));
  if (!source) return () => undefined;
  return source.watch(() => target(readDesktop(source)));
}
