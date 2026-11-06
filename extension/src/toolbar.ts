/**
 * The toolbar button as a status light: monochrome bus when connected and idle, coloured
 * while an agent is at work, a yellow dot while paused, a red one without a bridge connection.
 * What to show is `toolbarLook` in core, in the ladder `alarmOf` there names; this file only
 * paints it, on whichever button API the browser has (`action` in MV3, `browserAction` in MV2).
 */

import { browser } from '@wxt-dev/browser';
import {
  ACTIVE_MS,
  inkForScheme,
  inkForThemeColour,
  resolveSchemeDark,
  toolbarLook,
  wildcardGrant,
  type Connection,
  type ToolbarIcon,
  type ToolbarInk,
} from '@beifahrer/core';
import { activityState, onActivityChange } from './activity.ts';
import { currentStatus, onStatusChange } from './bridge-client.ts';
import { loadGrants, onGrantsChange } from './grants.ts';
import { t } from './i18n.ts';
import { installScheme, reportedByPage, reportedDark } from './scheme.ts';
import { loadSettings } from './settings.ts';
import { iconFile, ICON_SIZES } from '../manifest.ts';

interface ButtonApi {
  setIcon?(details: { path: Record<string, string> }): Promise<void>;
  setBadgeText?(details: { text: string }): Promise<void>;
  setTitle?(details: { title: string }): Promise<void>;
}

function button(): ButtonApi | null {
  const b = browser as unknown as { action?: ButtonApi; browserAction?: ButtonApi };
  return b.action ?? b.browserAction ?? null;
}

interface ThemeApi {
  getCurrent?(): Promise<{ colors?: Record<string, unknown> | null } | undefined>;
  onUpdated?: { addListener(cb: () => void): void };
}

const darkQuery = (): MediaQueryList | null =>
  globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

/**
 * A background PAGE (Safari, Firefox's MV2) that never declares `color-scheme` is, per WebKit,
 * treated as not dark-mode aware: `prefers-color-scheme` then always evaluates `light`, because the
 * engine will not safely assume dark system colours for a document that never opted in (WebKit's
 * "Dark Mode Support in WebKit"; confirmed for extension contexts by a WebKit engineer,
 * w3c/webextensions#242). The popup, options and confirm pages already declare it with a `<meta>`
 * tag; the background page draws nothing and has none, so `matchMedia` there answered `false`
 * even in a dark system, and the toolbar bus painted in the dark ink (near-black) on a dark
 * toolbar. `document` only exists in a background PAGE, never in an MV3 service worker (Chromium,
 * Edge), so the check also doubles as the feature test.
 */
function optInColourScheme(): void {
  if (typeof document !== 'undefined') document.documentElement.style.colorScheme = 'light dark';
}

/**
 * The ink of the toolbar's own icons (ADR 0025 § 11): Firefox tells us through the theme's icon or
 * text colour (light text means a dark toolbar), else the colour scheme, through
 * `resolveSchemeDark` (core): a live extension page's own report first — the fix for Safari's
 * background page, whose `matchMedia` can go stale for as long as the bridge's socket keeps it
 * alive (docs/traps-browser-platform.md) — else the background's own `matchMedia` where it has a
 * `document`, else the offscreen document's report (src/scheme.ts) in a Chromium service worker,
 * which has neither; until any of them has answered, the dark ink.
 */
async function currentInk(): Promise<ToolbarInk> {
  try {
    const theme = (browser as unknown as { theme?: ThemeApi }).theme;
    const colors = (await theme?.getCurrent?.())?.colors;
    for (const key of ['icons', 'toolbar_text', 'bookmark_text']) {
      const ink = inkForThemeColour(colors?.[key]);
      if (ink) return ink;
    }
  } catch {
    // no theme API here: fall through to the colour scheme
  }
  const query = darkQuery();
  const dark = resolveSchemeDark({
    reportedByPage: reportedByPage(),
    matches: query ? query.matches : null,
    offscreenDark: reportedDark(),
  });
  return inkForScheme(dark);
}

function iconPath(variant: ToolbarIcon, ink: ToolbarInk): Record<string, string> {
  // PNGs in every browser — see iconPaths() in manifest.ts for why not SVG in Firefox.
  const out: Record<string, string> = {};
  for (const size of ICON_SIZES.filter((s) => s <= 32))
    out[String(size)] = `/icons/${iconFile(variant, size, ink)}`;
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
  const ink = await currentInk();
  const key = JSON.stringify([look, ink]);
  if (key === painted) return;
  painted = key;
  await api.setIcon?.({ path: iconPath(look.icon, ink) });
  // No badge: Firefox draws it over the 16 px icon. Clear one an older version left behind.
  await api.setBadgeText?.({ text: '' });
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
  optInColourScheme();
  onStatusChange(() => void refreshToolbar());
  onActivityChange(() => void refreshToolbar());
  onGrantsChange(() => void refreshToolbar());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.paused) void refreshToolbar();
  });
  // The toolbar's icon colour moves with the theme and the system's colour scheme.
  (browser as unknown as { theme?: ThemeApi }).theme?.onUpdated?.addListener(() => void refreshToolbar());
  darkQuery()?.addEventListener('change', () => void refreshToolbar());
  installScheme(() => void refreshToolbar());
  void refreshToolbar();
}
