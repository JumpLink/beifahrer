/**
 * What the bridge knows about the person's desktop and the extension may use to look native
 * there: today only GNOME's accent colour (`org.gnome.desktop.interface accent-color`).
 *
 * The bridge runs on the person's desktop; the extension runs in a browser that, depending on the
 * engine, may not expose the desktop's accent at all. So the bridge reads it and says it, in the
 * welcome and in a `desktop` frame when it changes, and the extension remembers the latest one.
 *
 * Purely cosmetic, and still parsed fail-closed: the bridge is the agent's side, so only the nine
 * names of libadwaita's palette are accepted, never a colour value the extension would paint.
 */

/**
 * `AdwAccentColor`'s nine names, in its own order. The same set as `@gjsify/adwaita-core`'s
 * `AdwAccentColorName`, spelled out here because core has no dependencies.
 */
export const DESKTOP_ACCENTS = [
  'blue',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'slate',
] as const;

export type DesktopAccent = (typeof DESKTOP_ACCENTS)[number];

/** libadwaita's default, and what the extension uses when it knows nothing better. */
export const DEFAULT_ACCENT: DesktopAccent = 'blue';

export interface DesktopInfo {
  /** Absent when the desktop has no accent setting (not GNOME, or GNOME before 47). */
  accent?: DesktopAccent;
}

/** One of the nine names, or null for anything else. */
export function parseDesktopAccent(raw: unknown): DesktopAccent | null {
  return typeof raw === 'string' && (DESKTOP_ACCENTS as readonly string[]).includes(raw)
    ? (raw as DesktopAccent)
    : null;
}

/** A `desktop` object from the wire. Unknown keys and values are dropped, never an error. */
export function parseDesktop(raw: unknown): DesktopInfo {
  const accent = parseDesktopAccent((raw as { accent?: unknown } | null)?.accent);
  return accent ? { accent } : {};
}

/**
 * Which accent a page shows:
 *   1. the desktop's, as the latest bridge told it (`remembered`, straight from storage);
 *   2. else the browser's own `AccentColor`, where the engine supports it;
 *   3. else Adwaita blue.
 * The bridge comes first because it works in every browser; `AccentColor` is not exposed by every
 * engine, and where it is, it need not match GNOME's setting.
 */
export type AccentChoice =
  | { from: 'desktop'; name: DesktopAccent }
  | { from: 'system' }
  | { from: 'default'; name: DesktopAccent };

export function chooseAccent(remembered: unknown, systemAccentSupported: boolean): AccentChoice {
  const name = parseDesktopAccent(remembered);
  if (name) return { from: 'desktop', name };
  if (systemAccentSupported) return { from: 'system' };
  return { from: 'default', name: DEFAULT_ACCENT };
}
