/**
 * The desktop's accent colour, read where the bridge runs and passed to the extension, so the
 * extension's pages can follow the desktop's accent in every browser (core `desktop.ts`).
 *
 * On GJS, in a GNOME session, it is GSettings `org.gnome.desktop.interface accent-color` (GNOME
 * 47+), watched for changes. On macOS it is the system accent, `AppleAccentColor` in the global
 * preferences domain, re-read every few seconds: Safari's WebKit resolves CSS `AccentColor` to blue
 * whatever the setting, so without the bridge Safari could not follow it at all. Anywhere else
 * (Node, which runs the unit tests; another desktop) there is no source, and the welcome carries no
 * accent: the extension then falls back on its own.
 */

import { parseDesktop, type DesktopAccent, type DesktopInfo } from '@beifahrer/core';

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

// fixed upstream in gjsify: `adwAccentFromAppleAccentColor` (@gjsify/adwaita-core) and
// `readMacosAccentColor` + `onMacosAccentColorChanged` (@gjsify/adwaita-app/system-accent).
// Replace the three below with those once the app is on a gjsify release that ships them.

/**
 * `AppleAccentColor` → the libadwaita accent of the same name; graphite (-1) is slate. `null` means
 * the key is absent, "Multicolor", where apps keep their own accent: Adwaita's own is blue. Any
 * value macOS does not define gives null.
 */
export function adwAccentFromAppleAccentColor(value: string | null): DesktopAccent | null {
  if (value === null) return 'blue';
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  return APPLE_ACCENTS[Number(text)] ?? null;
}

const APPLE_ACCENTS: Readonly<Record<number, DesktopAccent>> = {
  [-1]: 'slate',
  0: 'red',
  1: 'orange',
  2: 'yellow',
  3: 'green',
  4: 'blue',
  5: 'purple',
  6: 'pink',
};

/** `defaults read -g AppleAccentColor`; what `defaults` says on stderr when the key is not set. */
const APPLE_ACCENT_ARGV = ['defaults', 'read', '-g', 'AppleAccentColor'];
const KEY_ABSENT = /Could not find key|does not exist/;

/** Seconds between two reads of the macOS accent. */
export const MACOS_POLL_SECONDS = 5;

/** The bits of GJS's Gio and GLib the macOS source uses, typed by hand like `GioLike`. */
interface MacGi {
  Gio: {
    Subprocess: {
      // A property, not `new (…)`: in a type literal that would be a construct signature.
      new: (
        argv: string[],
        flags: number,
      ) => {
        communicate_utf8(stdin: null, cancellable: null): [boolean, string | null, string | null];
        get_successful(): boolean;
      };
    };
    SubprocessFlags: { STDOUT_PIPE: number; STDERR_PIPE: number };
  };
  GLib: {
    PRIORITY_LOW: number;
    SOURCE_CONTINUE: boolean;
    timeout_add_seconds(priority: number, interval: number, fn: () => boolean): number;
    source_remove(id: number): boolean;
  };
}

/**
 * The macOS system accent on GJS, or null without GJS. There is no change signal GI can reach
 * (macOS posts a distributed notification only AppKit observes), so `watch` re-reads every
 * {@link MACOS_POLL_SECONDS}: one `defaults` process, about 7 ms. The bridge drops an unchanged
 * accent itself (`setDesktop`), so a tick that finds the same one sends nothing.
 */
export function macosAccentSource(): AccentSource | null {
  const gi = (globalThis as { imports?: { gi?: Partial<MacGi> } }).imports?.gi;
  if (!gi?.Gio || !gi.GLib) return null;
  const { Gio, GLib } = gi as MacGi;
  return {
    read() {
      let ok: boolean;
      let stdout: string | null;
      let stderr: string | null;
      try {
        const child = Gio.Subprocess.new(
          APPLE_ACCENT_ARGV,
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );
        [, stdout, stderr] = child.communicate_utf8(null, null);
        ok = child.get_successful();
      } catch {
        // Spawning throws where there is no `defaults`, communicating on an I/O error: either
        // way there is no accent to follow, which the extension handles as "unknown".
        return null;
      }
      if (ok) return adwAccentFromAppleAccentColor(stdout ?? '');
      return KEY_ABSENT.test(stderr ?? '') ? adwAccentFromAppleAccentColor(null) : null;
    },
    watch(changed) {
      const id = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, MACOS_POLL_SECONDS, () => {
        changed();
        return GLib.SOURCE_CONTINUE;
      });
      return () => GLib.source_remove(id);
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
 * that its result does not depend on the machine's desktop); otherwise GSettings in a GNOME
 * session, and the system accent on macOS. Everywhere else there is none, and the extension
 * follows the browser's `AccentColor`.
 *
 * GNOME is decided by the session, never by the platform: a Linux desktop that is not GNOME has
 * no accent the bridge could read. macOS is decided by the platform, which has one accent setting
 * whatever runs on it, and is checked second so that a GNOME session always reads GNOME's.
 */
export function desktopSource(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): AccentSource | null {
  const forced = env.BEIFAHRER_DESKTOP_ACCENT;
  if (forced) return fixedAccentSource(forced);
  if (isGnomeSession(env)) return gnomeAccentSource();
  return platform === 'darwin' ? macosAccentSource() : null;
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
