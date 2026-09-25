/**
 * The two browser-wide gates in front of the per-site policy: the PAUSE switch and the FEATURE
 * allowlist. Both are set by the person in the browser (popup, options, the in-page Stop button,
 * a keyboard shortcut) and enforced in the extension, like the policy (ADR 0005).
 *
 * The order of every check, and `preflight` below is the first half of it:
 *
 *   1. paused?            → `paused`, whatever the method (listing tabs too)
 *   2. feature switched off → `feature_disabled`, naming the feature
 *   3. the per-site level  (policy.ts `decide`)
 *   4. the browser's host grant
 *   5. the confirmation window, for writes
 *
 * Fail-closed like the policy: a method with no feature is refused, a stored switch that is not a
 * literal boolean is off, and storage that is not an object at all switches everything off.
 */

import type { Method } from './policy.ts';

/** One switch per capability. `download` is reserved for when that method exists. */
export const FEATURES = [
  'tabs',
  'read',
  'outline',
  'screenshot',
  'fill',
  'click',
  'open',
  'manageTabs',
  'sessions',
] as const;

export type Feature = (typeof FEATURES)[number];

export type Features = Record<Feature, boolean>;

/**
 * What the person sees next to each switch, and what an error names. `label` is short enough for
 * the popup; `detail` says which tools it covers.
 */
export const FEATURE_INFO: Record<Feature, { label: string; detail: string }> = {
  tabs: { label: 'See open tabs', detail: 'tabs_list, tab_active — sites below Read show their host only' },
  read: { label: 'Read page text', detail: 'page_read' },
  outline: { label: 'Outline pages', detail: 'page_outline — links, buttons, fields' },
  screenshot: {
    label: 'Take screenshots',
    detail: 'page_screenshot — of the visible tab only; Chromium also needs the all-sites grant below',
  },
  fill: { label: 'Fill fields', detail: 'page_fill — still needs Read + edit on the site' },
  click: { label: 'Click', detail: 'page_click — still needs Read + edit on the site' },
  open: { label: 'Open tabs', detail: 'tab_open — only sites at Read or higher' },
  manageTabs: {
    label: 'Manage tabs and windows',
    detail: 'tabs_move, tabs_pin, tabs_close, tabs_group, tabs_ungroup, window_create',
  },
  sessions: {
    label: 'Saved sessions',
    detail: 'sessions_save/list/restore/delete/define, recently closed windows',
  },
};

/**
 * Reading and ordinary page work on; the per-site level still decides where. Writes are on here
 * because each one still needs `write` on its site and, by default, the person's confirmation.
 * Screenshots, tab management and sessions are off: each reaches beyond the one site the person
 * set a level for.
 */
export const DEFAULT_FEATURES: Features = {
  tabs: true,
  read: true,
  outline: true,
  screenshot: false,
  fill: true,
  click: true,
  open: true,
  manageTabs: false,
  sessions: false,
};

/**
 * The one feature each method belongs to. `satisfies Record<Method, Feature>` makes a new method
 * without a feature a type error; `featureOf` refuses one that slipped past the type system.
 */
export const FEATURE_OF = {
  'tabs.list': 'tabs',
  'tabs.active': 'tabs',
  'page.read': 'read',
  'page.outline': 'outline',
  'page.screenshot': 'screenshot',
  'page.fill': 'fill',
  'page.click': 'click',
  'tabs.open': 'open',
  'tabs.move': 'manageTabs',
  'tabs.pin': 'manageTabs',
  'tabs.close': 'manageTabs',
  'tabs.group': 'manageTabs',
  'tabs.ungroup': 'manageTabs',
  'windows.create': 'manageTabs',
  'sessions.save': 'sessions',
  'sessions.list': 'sessions',
  'sessions.restore': 'sessions',
  'sessions.delete': 'sessions',
  'sessions.define': 'sessions',
  'sessions.recentlyClosed': 'sessions',
  'sessions.restoreClosed': 'sessions',
} as const satisfies Record<Method, Feature>;

export function featureOf(method: string): Feature | null {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_OF, method)) return null;
  return FEATURE_OF[method as Method];
}

export interface Gates {
  paused: boolean;
  features: Features;
}

export type Preflight =
  | { allow: true; feature: Feature }
  | { allow: false; code: 'paused' }
  | { allow: false; code: 'feature_disabled'; feature: Feature | null };

/** Steps 1 and 2 of the check order. The per-site level, grant and confirmation follow in the handler. */
export function preflight(gates: Gates, method: string): Preflight {
  if (gates.paused !== false) return { allow: false, code: 'paused' };
  const feature = featureOf(method);
  if (feature === null) return { allow: false, code: 'feature_disabled', feature: null };
  if (gates.features[feature] !== true) return { allow: false, code: 'feature_disabled', feature };
  return { allow: true, feature };
}

/** The message the agent gets for a refused preflight: what happened and whom to ask. */
export function preflightMessage(refusal: Exclude<Preflight, { allow: true }>, method: string): string {
  if (refusal.code === 'paused')
    return 'the person paused beifahrer in the browser — ask them to resume. Nothing the agent asks is served while it is paused.';
  if (refusal.feature === null) return `${method} belongs to no beifahrer feature, so it is refused`;
  return (
    `${method} needs the feature "${FEATURE_INFO[refusal.feature].label}", which the person switched off in beifahrer. ` +
    'Ask them to switch it on in the beifahrer toolbar popup or options — it is their decision.'
  );
}

/**
 * Parse the stored switches. `legacy` is PR #8's `grants` object: its one switch, `manageTabs`,
 * covered tab management AND sessions, so a person who turned it on keeps both on until they set
 * either one here.
 */
export function parseFeatures(raw: unknown, legacy?: unknown): Features {
  const legacyOn = (legacy as { manageTabs?: unknown } | null)?.manageTabs === true;
  const fallback: Features = legacyOn
    ? { ...DEFAULT_FEATURES, manageTabs: true, sessions: true }
    : { ...DEFAULT_FEATURES };
  if (raw === undefined || raw === null) return fallback;
  const out = {} as Features;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    for (const f of FEATURES) out[f] = false;
    return out;
  }
  const src = raw as Record<string, unknown>;
  for (const f of FEATURES) {
    if (!Object.prototype.hasOwnProperty.call(src, f)) out[f] = fallback[f];
    else out[f] = src[f] === true;
  }
  return out;
}

/**
 * The stored pause switch. Never set means running; a stored value that is not a boolean means
 * paused — a broken kill switch must fail towards stopped.
 */
export function parsePaused(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  return raw !== false;
}
