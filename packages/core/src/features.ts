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

/** One switch per capability. */
export const FEATURES = [
  'tabs',
  'read',
  'outline',
  'screenshot',
  'download',
  'network',
  'fill',
  'click',
  'script',
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
  outline: {
    label: 'Outline pages',
    detail: 'page_outline, page_find, page_wait, page_expect — links, buttons, fields',
  },
  download: { label: 'Download documents', detail: 'page_download — a file the page links to' },
  network: {
    label: 'See what a page requests',
    detail:
      'page_network — what the tab asked for and what came back, without query strings. The browser ' +
      'grants this separately, and the grant is what a request log is: your browsing, in a list',
  },
  screenshot: {
    label: 'Take screenshots',
    detail: 'page_screenshot — of the visible tab only; Chromium also needs the all-sites grant below',
  },
  fill: {
    label: 'Fill in forms',
    detail:
      'page_fill, page_press, page_select, page_check — text into a field, keys into a form, a ' +
      'dropdown option, a checkbox. Still needs Read + edit on the site, and a key can submit a form',
  },
  click: { label: 'Click', detail: 'page_click — still needs Read + edit on the site' },
  script: {
    label: 'Run scripts',
    detail:
      'page_evaluate — the agent runs its own code in the page. Needs Read + edit on the site, and you see every script before it runs',
  },
  open: {
    label: 'Point the browser at a URL',
    detail: 'tab_open, page_navigate — opening a tab, following a link by URL, back/forward/reload',
  },
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
 * Screenshots, downloads, tab management and sessions are off: each reaches beyond reading the
 * one page in front of the person — a download turns a link into an authenticated request, and
 * that is a thing to switch on deliberately.
 */
export const DEFAULT_FEATURES: Features = {
  tabs: true,
  read: true,
  outline: true,
  screenshot: false,
  download: false,
  // Off by default, and the one switch whose DEFAULT is the honest answer: a request log is a
  // browsing history with timestamps, and `webRequest` cannot be narrowed to one site. The person
  // grants it in the same click that switches it on, and taking it away in the browser switches the
  // feature off with it.
  network: false,
  fill: true,
  click: true,
  // Off, with screenshots, downloads, tab management and sessions: every capability that reaches
  // past "act on the one page in front of the person" — and this one more than any of them. Running
  // the agent's own code in a tab is switched on deliberately, per browser, and every run asks
  // (ADR 0012).
  script: false,
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
  // Asking what would be allowed is part of looking: without it an agent cannot find out that a
  // switch is off before it spends a call on the refusal (issue #27). It refuses while paused with
  // everything else — a question is still a request.
  'access.check': 'tabs',
  'page.read': 'read',
  'page.outline': 'outline',
  // find + wait see the same element model outline shows, so the same switch covers them.
  'page.find': 'outline',
  'page.wait': 'outline',
  // An assertion is a question about the same elements in the same documents — one switch, and
  // switching "Outline pages" off has to take the questions with it, or an agent could still learn
  // what a page is made of out of yes/no answers.
  'page.expect': 'outline',
  'page.screenshot': 'screenshot',
  'page.download': 'download',
  'page.network': 'network',
  'page.fill': 'fill',
  // press, select and check ride on `fill`, not on switches of their own. They are the same act —
  // putting a value into a form control — and a page agent needs all four to get through one form.
  // The reason is consent, not tidiness: a person who switches OFF "Fill fields" means "do not type
  // into my pages", and a key press that types would have to be switched off separately to mean the
  // same thing. `page.click` keeps its own switch, because clicking is not filling.
  'page.press': 'fill',
  'page.select': 'fill',
  'page.check': 'fill',
  'page.click': 'click',
  'page.evaluate': 'script',
  // Navigation rides on the same switch as opening a tab: both are the agent pointing the
  // browser at a URL, and both are bounded by `read` on the site named. One switch, because
  // "may the agent send the browser somewhere" is one decision, not two.
  'page.navigate': 'open',
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
