/**
 * Whether closing the window keeps Beifahrer running, and what it says while it does (ADR 0024).
 * Pure: no portal, no widget, so the rule and the words are tested without a display.
 *
 * Closing hides the window only where the person can get it back: a status icon, the Dock (macOS keeps
 * a running app there with its dot, and a click brings the window back), or the Background portal's grant
 * (GNOME lists the app under Background Apps). An invisible process nobody can find is worse than none,
 * so everything else quits, as before.
 */

import type { StatusView } from './status-model.ts';
import type { Translate } from './i18n.ts';

/** What the Background portal answered; `unavailable` is no Flatpak, no libportal or no portal. */
export type BackgroundAnswer = 'granted' | 'denied' | 'unavailable';

export interface CloseContext {
  /** A status icon is shown. Always false until gjsify has `@gjsify/status-icon` (ADR 0024 § 5). */
  statusIcon: boolean;
  /** macOS: the running app stays in the Dock and a click on it reopens the window (ADR 0024 § 2). */
  dock: boolean;
  background: BackgroundAnswer;
}

export function onClose({ statusIcon, dock, background }: CloseContext): 'hide' | 'quit' {
  return statusIcon || dock || background === 'granted' ? 'hide' : 'quit';
}

/** The portal's own limit on `set_background_status`. */
export const BACKGROUND_STATUS_MAX = 96;

/** `text` cut to `max` characters, with an ellipsis where something was cut. */
export function clip(text: string, max: number = BACKGROUND_STATUS_MAX): string {
  const chars = [...text];
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** The rung the status page shows, as one line for the portal: an alarm says its title, ready counts. */
export function backgroundLine(view: StatusView, t: Translate): string {
  const count = view.sessions.length;
  if (view.alarm || count === 0) return clip(view.title);
  return clip(t(count === 1 ? 'background.status.one' : 'background.status.many', { count }));
}

/** Inside a Flatpak sandbox: `/.flatpak-info` exists, or the runtime set `FLATPAK_ID`. */
export function inFlatpak(infoExists: boolean, env: { FLATPAK_ID?: string }): boolean {
  return infoExists || Boolean(env.FLATPAK_ID);
}
