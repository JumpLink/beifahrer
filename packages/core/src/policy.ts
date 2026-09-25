/**
 * The per-origin policy: what the agent may do on which site.
 *
 * This is the one gate in beifahrer that matters, and the extension enforces it in the browser —
 * never the bridge, because the bridge is the side the agent talks to. Everything here is pure so
 * that the decision can be tested on its own, exhaustively, without a browser.
 *
 * Fail-closed throughout: an origin nobody configured is `none`, a URL that is not http(s) has no
 * origin and therefore no access, and a method this table does not know is refused.
 */

export type Level = 'none' | 'read' | 'write';

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

export interface OriginRule {
  level: Level;
  /**
   * Only meaningful for `write`: when false, writes on this origin skip the confirmation window.
   * Absent means true — asking is the default, not the opt-in.
   */
  confirmWrites?: boolean;
}

export interface Policy {
  /** Keyed by origin as `originOf()` returns it, e.g. `https://example.org`. */
  origins: Record<string, OriginRule>;
}

export const EMPTY_POLICY: Policy = { origins: {} };

/**
 * The origin of a URL, or null when the URL has none the policy can talk about.
 *
 * Only http(s) qualifies. `about:`, `chrome://`, `moz-extension://`, `file://` and friends are
 * browser-internal or local; letting a rule reach them would let a page the person never looked
 * at in a browser — a local file, another extension's UI — become readable by name.
 */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.origin;
}

export function levelFor(policy: Policy, url: string | undefined | null): Level {
  const origin = originOf(url);
  if (!origin) return 'none';
  return policy.origins[origin]?.level ?? 'none';
}

export function atLeast(have: Level, need: Level): boolean {
  return RANK[have] >= RANK[need];
}

/**
 * The level each method needs on the origin it touches. `null` means the method touches no page
 * content — listing tabs is always allowed, and redaction (`redactTab`) is what protects the
 * tabs the agent may not see.
 */
export const REQUIRED_LEVEL = {
  'tabs.list': null,
  'tabs.active': null,
  'page.read': 'read',
  'page.outline': 'read',
  'page.screenshot': 'read',
  'page.fill': 'write',
  'page.click': 'write',
  // Opening a URL needs `read` on the TARGET: otherwise an agent that just read something could
  // carry it off in the query string of a URL the person never allowed.
  'tabs.open': 'read',
  // Tab and window management. These touch no page content, so the per-site level is not their
  // gate — the browser-level grant in REQUIRED_GRANT is. Where one opens a NEW URL the agent
  // supplies (`windows.create` with urls, `sessions.define`), that URL needs `read`, like
  // `tabs.open`, and the handler checks it per URL.
  'tabs.move': null,
  'tabs.pin': null,
  'tabs.close': null,
  'tabs.group': null,
  'tabs.ungroup': null,
  'windows.create': 'read',
  'sessions.save': null,
  'sessions.list': null,
  'sessions.restore': null,
  'sessions.delete': null,
  'sessions.define': 'read',
  'sessions.recentlyClosed': null,
  'sessions.restoreClosed': null,
} as const satisfies Record<string, Level | null>;

export type Method = keyof typeof REQUIRED_LEVEL;

export function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REQUIRED_LEVEL, value);
}

/**
 * Browser-level grants: switches that are not about one site but about the browser as a whole.
 * The person flips them in the extension (popup, options); nothing else can.
 *
 * `manageTabs` — "Let the agent manage tabs and windows": move, pin, close, group, and the saved
 * sessions. Off by default: rearranging or closing someone's tabs is not something an agent
 * should find switched on.
 */
export interface Grants {
  manageTabs: boolean;
}

export type Grant = keyof Grants;

export const NO_GRANTS: Grants = { manageTabs: false };

/**
 * The browser-level grant each method needs, next to its per-site level. One entry per method —
 * `satisfies Record<Method, …>` makes a method that forgot to say which grant it needs a type
 * error, so the table cannot fall behind REQUIRED_LEVEL.
 */
export const REQUIRED_GRANT = {
  'tabs.list': null,
  'tabs.active': null,
  'page.read': null,
  'page.outline': null,
  'page.screenshot': null,
  'page.fill': null,
  'page.click': null,
  'tabs.open': null,
  'tabs.move': 'manageTabs',
  'tabs.pin': 'manageTabs',
  'tabs.close': 'manageTabs',
  'tabs.group': 'manageTabs',
  'tabs.ungroup': 'manageTabs',
  'windows.create': 'manageTabs',
  'sessions.save': 'manageTabs',
  'sessions.list': 'manageTabs',
  'sessions.restore': 'manageTabs',
  'sessions.delete': 'manageTabs',
  'sessions.define': 'manageTabs',
  'sessions.recentlyClosed': 'manageTabs',
  'sessions.restoreClosed': 'manageTabs',
} as const satisfies Record<Method, Grant | null>;

export type GrantDecision = { allow: true } | { allow: false; grant: Grant };

/** Does the person's browser-level switch allow `method` at all? Checked before the per-site level. */
export function decideGrant(grants: Grants, method: Method): GrantDecision {
  const grant = REQUIRED_GRANT[method] as Grant | null | undefined;
  if (grant === null) return { allow: true };
  // A method missing from the table (only possible past the type system) is refused, not waved on.
  if (grant === undefined) return { allow: false, grant: 'manageTabs' };
  return grants[grant] === true ? { allow: true } : { allow: false, grant };
}

/** Grants read back from storage: only a literal `true` switches one on. */
export function parseGrants(raw: unknown): Grants {
  return { manageTabs: (raw as { manageTabs?: unknown } | null)?.manageTabs === true };
}

export type Decision =
  | { allow: true; confirm: boolean }
  | { allow: false; origin: string | null; have: Level; need: Level };

/**
 * May `method` run against a page at `url`?
 *
 * `confirm` is true for every write unless the person switched confirmation off for that origin.
 */
export function decide(policy: Policy, method: Method, url: string | undefined | null): Decision {
  const need = REQUIRED_LEVEL[method];
  if (need === null) return { allow: true, confirm: false };
  const origin = originOf(url);
  const have = levelFor(policy, url);
  if (!atLeast(have, need)) return { allow: false, origin, have, need };
  const confirm = need === 'write' && (origin ? policy.origins[origin]?.confirmWrites !== false : true);
  return { allow: true, confirm };
}

/** A new policy with `origin` set to `rule`; `none` removes the entry so the default applies. */
export function withRule(policy: Policy, origin: string, rule: OriginRule): Policy {
  const origins = { ...policy.origins };
  if (rule.level === 'none') delete origins[origin];
  else origins[origin] = rule;
  return { origins };
}

/**
 * Parse a policy read back from storage. Anything malformed is dropped entry by entry rather than
 * rejected wholesale: a single broken entry must not widen access, and must not wipe the
 * person's other choices either.
 */
export function parsePolicy(raw: unknown): Policy {
  const origins: Record<string, OriginRule> = {};
  const src = (raw as { origins?: unknown } | null)?.origins;
  if (!src || typeof src !== 'object') return { origins };
  for (const [key, value] of Object.entries(src as Record<string, unknown>)) {
    if (originOf(key) !== key) continue;
    const level = (value as { level?: unknown } | null)?.level;
    if (level !== 'read' && level !== 'write') continue;
    const confirmWrites = (value as { confirmWrites?: unknown }).confirmWrites;
    origins[key] = confirmWrites === false ? { level, confirmWrites: false } : { level };
  }
  return { origins };
}
