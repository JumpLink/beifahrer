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
  /**
   * `none` is an explicit block: the person set this site to None, so no temporary grant — not
   * even "all sites" — reaches it, and the agent is not offered a prompt for it either.
   */
  level: Level;
  /**
   * Only meaningful for `write`: when false, writes on this origin skip the confirmation window.
   * Absent means true — asking is the default, not the opt-in.
   */
  confirmWrites?: boolean;
}

/**
 * A temporary widening the person granted in the browser (ADR 0010): all sites for an hour, one
 * site for one agent session, and so on. Never stored with the policy: grants live in the
 * extension's session storage, so none survives a browser restart.
 */
export interface Grant {
  /** `*` is every http(s) site the person has no explicit rule for; otherwise one origin. */
  scope: '*' | string;
  level: 'read' | 'write';
  /** ms since the epoch. Absent: until the browser closes (or the session ends, see below). */
  until?: number;
  /** Only this agent session (its connection id); the grant ends when that connection closes. */
  sessionId?: string;
}

/** When and for whom a decision is made. Without it, temporary grants do not apply at all. */
export interface AccessContext {
  now: number;
  /** The connection id of the agent session asking, if any. */
  session?: string;
}

export interface Policy {
  /** Keyed by origin as `originOf()` returns it, e.g. `https://example.org`. */
  origins: Record<string, OriginRule>;
  /** Temporary grants, merged in by the extension at decision time. Absent means none. */
  grants?: readonly Grant[];
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

/** Where an origin's level came from, which decides whether its writes are confirmed. */
export type AccessSource = 'none' | 'rule' | 'blocked' | 'wildcard' | 'grant';

export interface Access {
  origin: string | null;
  level: Level;
  source: AccessSource;
}

/** A grant is live when it has not run out and, if tied to a session, that session is asking. */
export function grantLive(grant: Grant, ctx: AccessContext): boolean {
  if (grant.until !== undefined && !(ctx.now < grant.until)) return false;
  if (grant.sessionId !== undefined && grant.sessionId !== ctx.session) return false;
  return true;
}

/**
 * The level the agent has on `url`, and why. Precedence, and every step fails closed:
 *
 *   1. no http(s) origin            → none
 *   2. an explicit `none` rule       → none, whatever is granted (the person blocked this site)
 *   3. an explicit rule              → its level; the "all sites" grant does NOT override it
 *   4. otherwise a live `*` grant    → its level
 *   5. a live grant for this origin → raises the level from 3 or 4 (an answered prompt)
 *
 * Without `ctx` no grant applies: a caller that does not say when it asks gets the policy only.
 */
export function accessFor(policy: Policy, url: string | undefined | null, ctx?: AccessContext): Access {
  const origin = originOf(url);
  if (!origin) return { origin, level: 'none', source: 'none' };
  const rule = Object.prototype.hasOwnProperty.call(policy.origins, origin)
    ? policy.origins[origin]
    : undefined;
  if (rule?.level === 'none') return { origin, level: 'none', source: 'blocked' };
  let level: Level = rule?.level ?? 'none';
  let source: AccessSource = rule ? 'rule' : 'none';
  if (!ctx) return { origin, level, source };
  const live = (policy.grants ?? []).filter((g) => grantLive(g, ctx));
  if (!rule) {
    for (const g of live) {
      if (g.scope === '*' && RANK[g.level] > RANK[level]) {
        level = g.level;
        source = 'wildcard';
      }
    }
  }
  for (const g of live) {
    if (g.scope === origin && RANK[g.level] > RANK[level]) {
      level = g.level;
      source = 'grant';
    }
  }
  return { origin, level, source };
}

export function levelFor(policy: Policy, url: string | undefined | null, ctx?: AccessContext): Level {
  return accessFor(policy, url, ctx).level;
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
  // find + wait read what outline reads (the same element model), so they need the same level.
  'page.find': 'read',
  'page.wait': 'read',
  'page.screenshot': 'read',
  // A document the page links to, fetched in the tab's own session. `read`, not `write`: it only
  // ever reads, and demanding `write` would push a bank or insurer origin up a level for the one
  // thing that has to stay harmless there.
  'page.download': 'read',
  'page.fill': 'write',
  'page.click': 'write',
  // Opening a URL needs `read` on the TARGET: otherwise an agent that just read something could
  // carry it off in the query string of a URL the person never allowed.
  'tabs.open': 'read',
  // Tab and window management. These touch no page content, so the per-site level is not their
  // gate — the person's feature switch is (FEATURE_OF in features.ts). Where one opens a NEW URL the agent
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

export type Decision =
  | { allow: true; confirm: boolean }
  | {
      allow: false;
      origin: string | null;
      have: Level;
      need: Level;
      /**
       * Whether the person may be asked for this origin right now: a web origin they did not
       * block. A browser page, a local file or an explicit `none` is refused without a prompt.
       */
      askable: boolean;
    };

/**
 * May `method` run against a page at `url`?
 *
 * `confirm` is true for every write unless the person switched confirmation off for that origin
 * in an explicit rule. A write that only a temporary grant allows ALWAYS asks: "all sites" and
 * "for this session" widen where the agent may go, never how quietly it may change things there.
 */
export function decide(
  policy: Policy,
  method: Method,
  url: string | undefined | null,
  ctx?: AccessContext,
): Decision {
  const need = REQUIRED_LEVEL[method];
  if (need === null) return { allow: true, confirm: false };
  const access = accessFor(policy, url, ctx);
  if (!atLeast(access.level, need)) {
    return {
      allow: false,
      origin: access.origin,
      have: access.level,
      need,
      askable: access.origin !== null && access.source !== 'blocked',
    };
  }
  const quiet = access.source === 'rule' && policy.origins[access.origin!]?.confirmWrites === false;
  return { allow: true, confirm: need === 'write' && !quiet };
}

/**
 * The live "all sites" grant, if any, for the toolbar and the popup. A session-bound one counts
 * too (it is live for SOME session); the latest end wins, and one with no end beats any.
 */
export function wildcardGrant(grants: readonly Grant[], now: number): Grant | null {
  let best: Grant | null = null;
  for (const g of grants) {
    if (g.scope !== '*' || (g.until !== undefined && !(now < g.until))) continue;
    if (!best || (best.until !== undefined && (g.until === undefined || g.until > best.until))) best = g;
  }
  return best;
}

/** The grants still worth keeping at `now`: run-out ones go, and those of sessions that ended. */
export function pruneGrants(
  grants: readonly Grant[],
  now: number,
  liveSessions?: ReadonlySet<string>,
): Grant[] {
  return grants.filter(
    (g) =>
      (g.until === undefined || now < g.until) &&
      (g.sessionId === undefined || liveSessions === undefined || liveSessions.has(g.sessionId)),
  );
}

/** The earliest end among `grants`, for the clean-up alarm; null when none runs out by time. */
export function nextExpiry(grants: readonly Grant[]): number | null {
  let next: number | null = null;
  for (const g of grants) if (g.until !== undefined && (next === null || g.until < next)) next = g.until;
  return next;
}

/**
 * How long the person has to answer a window (a write's confirmation, an access prompt) before
 * silence counts as no. The bridge's call timeouts are built from it, so a call waiting on the
 * person is not given up on the agent's side first.
 */
export const ASK_TIMEOUT_MS = 120_000;

/** Longest a timed grant may run. Anything longer read back from storage is malformed. */
export const MAX_GRANT_MS = 24 * 60 * 60 * 1000;

/**
 * Parse grants read back from session storage. Each malformed or run-out grant is dropped on its
 * own; nothing here can widen access past what a well-formed grant says.
 */
export function parseGrants(raw: unknown, now: number): Grant[] {
  if (!Array.isArray(raw)) return [];
  const out: Grant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const g = item as Record<string, unknown>;
    const scope = g.scope;
    if (scope !== '*' && (typeof scope !== 'string' || originOf(scope) !== scope)) continue;
    if (g.level !== 'read' && g.level !== 'write') continue;
    const grant: Grant = { scope, level: g.level };
    if (g.until !== undefined) {
      if (typeof g.until !== 'number' || !Number.isFinite(g.until)) continue;
      if (g.until <= now || g.until > now + MAX_GRANT_MS) continue;
      grant.until = g.until;
    }
    if (g.sessionId !== undefined) {
      if (typeof g.sessionId !== 'string' || !g.sessionId) continue;
      grant.sessionId = g.sessionId;
    }
    out.push(grant);
  }
  return out;
}

/**
 * A new policy with `origin` set to `rule`. A `none` rule is kept: it is the person's explicit
 * block, which an "all sites" grant must not reach. `withoutRule` forgets the site instead.
 */
export function withRule(policy: Policy, origin: string, rule: OriginRule): Policy {
  return { origins: { ...policy.origins, [origin]: rule } };
}

/** A new policy that has no rule for `origin`: back to the default (none, but not blocked). */
export function withoutRule(policy: Policy, origin: string): Policy {
  const origins = { ...policy.origins };
  delete origins[origin];
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
    if (level === 'none') {
      origins[key] = { level };
      continue;
    }
    if (level !== 'read' && level !== 'write') continue;
    const confirmWrites = (value as { confirmWrites?: unknown }).confirmWrites;
    origins[key] = confirmWrites === false ? { level, confirmWrites: false } : { level };
  }
  return { origins };
}

/** What the extension holds of the browser's host access beyond the stored policy's own sites. */
export interface HeldHosts {
  /** The "all sites" patterns were requested for a grant. */
  wildcard: boolean;
  /** Origins opened up for a prompt's answer ("Allow once", "For this session"). */
  origins: readonly string[];
}

/**
 * Which of the held host grants to give back to the browser now, so that no host access outlives
 * the grant it was requested for. A site the stored policy allows keeps its access, and so does a
 * site whose browser pattern (`patternOf`, per host) is still needed by another origin.
 * `grants` must already be pruned of ended sessions (`pruneGrants`).
 */
export function hostsToRelease(
  held: HeldHosts,
  policy: Policy,
  grants: readonly Grant[],
  now: number,
  patternOf: (origin: string) => string,
): HeldHosts {
  const live = pruneGrants(grants, now);
  const needed = new Set<string>();
  for (const [origin, rule] of Object.entries(policy.origins))
    if (rule.level !== 'none') needed.add(patternOf(origin));
  for (const g of live) if (g.scope !== '*') needed.add(patternOf(g.scope));
  return {
    wildcard: held.wildcard && wildcardGrant(live, now) === null,
    origins: held.origins.filter((o) => !needed.has(patternOf(o))),
  };
}
