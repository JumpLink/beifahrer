/**
 * The one thing every platform spells differently: a keyboard shortcut. `browser.commands`
 * reports a modifier string ("Alt+Shift+B") built for Windows and Linux even when the browser
 * runs on a Mac, because that is the manifest key spelling, not a display string. macOS never
 * shows a shortcut that way — it shows glyphs, in Apple's own order (Control, Option, Shift,
 * Command), with no separator.
 *
 * Some engines already translate this for us (Safari, and Chromium in places), so a raw value
 * that already carries a glyph is left exactly as it is: formatting it twice would be wrong
 * twice.
 */

/** libadwaita has no opinion here; this is Apple's own modifier order (HIG), left to right. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const;

/**
 * What each modifier word becomes on a Mac. "Ctrl" is deliberately mapped to Command: a manifest
 * that says `Ctrl+Shift+B` is interpreted by Chrome as the Command key once it runs on macOS (its
 * own docs call this out), so the token a `commands.getAll()` result carries there means ⌘, not
 * ⌃. The actual Control key is `MacCtrl`.
 */
const MAC_MODIFIERS: Record<string, string> = {
  macctrl: '⌃',
  ctrl: '⌘',
  control: '⌘',
  command: '⌘',
  cmd: '⌘',
  meta: '⌘',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
};

/** A raw value some engine already rendered as glyphs, e.g. Safari's own "⌥⇧B". */
const HAS_GLYPHS = /[⌃⌥⇧⌘]/;

/**
 * `raw` as `browser.commands.getAll()` or a manifest `suggested_key` spells it (e.g.
 * "Alt+Shift+B"); `os` as `browser.runtime.getPlatformInfo()` reports it ("mac", "win", …, or ""
 * when unknown). Empty input stays empty: whether that means "show nothing" or "show a fallback"
 * is a decision for the caller, not this formatter.
 */
export function formatShortcut(raw: string, os: string): string {
  const trimmed = raw.trim();
  if (!trimmed || HAS_GLYPHS.test(trimmed) || os !== 'mac') return trimmed;

  const keys = trimmed.split('+').map((part) => part.trim());
  const key = keys.pop() ?? '';
  const glyphs = new Set(
    keys.map((part) => MAC_MODIFIERS[part.toLowerCase()]).filter((g) => g !== undefined),
  );
  const ordered = MAC_ORDER.filter((glyph) => glyphs.has(glyph));
  return [...ordered, key].join('');
}
