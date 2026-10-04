/**
 * The toolbar button as a status light: monochrome sparkles when connected and idle, coloured
 * while an agent is at work, a yellow dot while paused, a red one without a bridge connection.
 * What to show is `toolbarLook` in core, in the ladder `alarmOf` there names; this file only
 * paints it, on whichever button API the browser has (`action` in MV3, `browserAction` in MV2).
 * The badge text is the fallback for a browser that cannot set the icon.
 */

import { browser } from '@wxt-dev/browser';
import {
  ACTIVE_MS,
  LOOK_COLOUR,
  toolbarLook,
  wildcardGrant,
  type Connection,
  type ToolbarIcon,
} from '@beifahrer/core';
import { activityState, onActivityChange } from './activity.ts';
import { currentStatus, onStatusChange } from './bridge-client.ts';
import { loadGrants, onGrantsChange } from './grants.ts';
import { t } from './i18n.ts';
import { loadSettings } from './settings.ts';
import { ICON_SIZES } from '../manifest.ts';

interface ButtonApi {
  setIcon?(details: { path: Record<string, string> }): Promise<void>;
  setBadgeText?(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor?(details: { color: string }): Promise<void>;
  setTitle?(details: { title: string }): Promise<void>;
}

function button(): ButtonApi | null {
  const b = browser as unknown as { action?: ButtonApi; browserAction?: ButtonApi };
  return b.action ?? b.browserAction ?? null;
}

function iconPath(variant: ToolbarIcon): Record<string, string> {
  // PNGs in every browser — see iconPaths() in manifest.ts for why not SVG in Firefox.
  const out: Record<string, string> = {};
  for (const size of ICON_SIZES.filter((s) => s <= 32)) out[String(size)] = `/icons/${variant}-${size}.png`;
  return out;
}

let painted = '';
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

export async function refreshToolbar(): Promise<void> {
  const api = button();
  if (!api) return;
  const [{ paused }, grants] = await Promise.all([loadSettings(), loadGrants()]);
  const { inFlight, lastActivityAt } = activityState();
  const now = Date.now();
  const look = toolbarLook({
    connection: currentStatus().state as Connection,
    paused,
    inFlight,
    lastActivityAt,
    now,
    wide: wildcardGrant(grants, now) !== null,
  });
  // The colour outlives the request by ACTIVE_MS; repaint when that runs out.
  clearTimeout(fadeTimer);
  if (inFlight === 0 && lastActivityAt > 0 && now - lastActivityAt < ACTIVE_MS)
    fadeTimer = setTimeout(() => void refreshToolbar(), ACTIVE_MS - (now - lastActivityAt) + 50);
  const key = JSON.stringify(look);
  if (key === painted) return;
  painted = key;
  if (api.setIcon) {
    await api.setIcon({ path: iconPath(look.icon) });
  } else if (api.setBadgeText) {
    await api.setBadgeText({ text: look.badge });
    // The badge paints the button in the look's own colour from core, the one the icon's dot is
    // drawn with: a fallback that showed another colour would say a different state than the icon.
    await api.setBadgeBackgroundColor?.({ color: LOOK_COLOUR[look.icon] });
  }
  await api.setTitle?.({ title: titleFor(look.icon, currentStatus().state as Connection) });
}

/**
 * The tooltip in the person's language. `toolbarLook` decides WHICH state the button shows; its
 * English `title` is the reference wording these messages translate.
 */
function titleFor(icon: ToolbarIcon, connection: Connection): string {
  if (icon === 'paused') return t('toolbar_paused');
  if (icon === 'wide' || icon === 'wide-active')
    return t(icon === 'wide' ? 'toolbar_wide' : 'toolbar_wide_active');
  if (connection !== 'connected') return t(`toolbar_offline_${connection}`);
  return t(icon === 'active' ? 'toolbar_active' : 'toolbar_idle');
}

/** Repaint on every change that can alter the look. Registered synchronously (MV3 wake-up). */
export function installToolbar(): void {
  onStatusChange(() => void refreshToolbar());
  onActivityChange(() => void refreshToolbar());
  onGrantsChange(() => void refreshToolbar());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.paused) void refreshToolbar();
  });
  void refreshToolbar();
}
