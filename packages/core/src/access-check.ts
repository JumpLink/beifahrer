/**
 * `access.check`: what WOULD happen if the agent called this method there — answered without
 * calling it (issue #27).
 *
 * The state that decides whether a call is served lives in the browser: the person's switches, the
 * level they set for the origin, the browser's own host grant. All of it is documented and none of
 * it is visible to an agent before the call, so an agent that gets refused learns it by spending a
 * call — or by retrying, which is the failure mode this exists to stop. This is the same question
 * `runMethod` asks internally, made into an answer instead of swallowed.
 *
 * It asks, and does not do: no window, no prompt, no access granted. `askable` says whether the
 * person COULD be asked, and nobody is asked here. So this is pure, and every decision in it is
 * made once, here, where it can be tested exhaustively without a browser.
 *
 * The order is the check order (features.ts), unchanged: paused → feature → per-site level → host
 * grant → confirm. `preflight` covers the first two, `accessFor` the third (never `decide().have`:
 * a decision that ALLOWED carries no level), the fourth is what the caller measured, and `confirm`
 * is read from `decide`, which answers it in both branches.
 */

import { type Feature, type Features, FEATURE_OF, preflight, preflightMessage } from './features.ts';
import {
  REQUIRED_LEVEL,
  accessFor,
  atLeast,
  decide,
  isMethod,
  type AccessContext,
  type Level,
  type Method,
  type Policy,
} from './policy.ts';

/** Which check decides the answer — the check order, read one step at a time. */
export type AccessStage = 'ok' | 'feature' | 'level' | 'grant' | 'unsupported';

/**
 * The whole answer, whatever the stage — one shape, so an agent can read a field without first
 * working out which refusal it is holding.
 *
 * A `type` and not an `interface`: this object goes straight into an MCP `structuredContent`, which
 * is indexed by key, and an interface has no implicit index signature. `loose()` (tools.ts) says so
 * where that cast lives; this is the same constraint at the other end of it.
 */
export type AccessCheck = {
  /** True only when the call would be served without a window and without anybody being asked. */
  allowed: boolean;
  stage: AccessStage;
  /** The one feature this method belongs to. */
  feature: Feature;
  /** Whether that switch is on right now — the person decides this, in the browser. */
  featureOn: boolean;
  origin: string | null;
  /** What the person set for this origin. In BOTH branches, which a `Decision` does not give. */
  have: Level;
  /** What this method needs; `none` when it touches no page, and so needs no level at all. */
  need: Level;
  /** Whether the call would open the confirmation window, on top of anything above. */
  confirm: boolean;
  /** Whether the person may be asked for this origin at all (a web origin they did not block). */
  askable: boolean;
  /** Whether the browser granted access to this origin; null where no grant is consulted. */
  hostGranted: boolean | null;
  /** One sentence an agent can act on: what decides it, and whom to ask. */
  reason: string;
};

export interface AccessCheckInput {
  /** The person's switches. The PAUSE is not here: it is answered before any handler runs. */
  features: Features;
  /** The stored policy, with the temporary grants merged in by the caller that owns them. */
  policy: Policy;
  ctx?: AccessContext;
  /**
   * A method name the policy table does not know is refused, fail-closed: this answers `invalid`
   * rather than "allowed because nothing said no".
   */
  method: string;
  /** The page in question. Absent, or not http(s), means no origin and therefore no access. */
  url?: string | null;
  /** Why THIS browser cannot serve the method at all, if it cannot (`unsupportedReasons`). */
  unsupported?: string | null;
  /** `browser.permissions.contains` for this origin. Null where the method needs no grant. */
  hostGranted?: boolean | null;
}

/**
 * The answer, or the sentence to refuse the QUESTION with.
 *
 * A string is `invalid` on the wire. A method this table does not know has no feature, no level and
 * no person behind it, so every value an answer about it carried would be a guess — and a guess
 * that said "allowed" is the one that must never exist.
 */
export function accessCheck(input: AccessCheckInput): AccessCheck | string {
  const { features, policy, ctx, unsupported } = input;
  if (!isMethod(input.method)) {
    return (
      `"${input.method}" is not a Beifahrer method. browsers_list names what this browser has; ` +
      'ask about one of those.'
    );
  }
  const method: Method = input.method;
  const access = accessFor(policy, input.url ?? null, ctx);
  const need = REQUIRED_LEVEL[method];
  // Both levels in one answer, always. `decide` returns a union whose allowed branch carries
  // neither `have` nor `need`, and reading one off a decision that allowed is no value at all —
  // `atLeast(undefined, 'read')` is false, which once dropped every allowed frame.
  const have = access.level;
  // Read from `decide`, not recomputed: `confirm` is answered in both branches, and recomputing it
  // is exactly where an ALWAYS_CONFIRM method would lose the rule that outranks a site rule.
  const decision = decide(policy, method, input.url ?? null, ctx);
  const confirm = decision.allow && decision.confirm;
  // Askable for the same reason `decide` asks it: an origin the person blocked, or none at all, is
  // refused without a prompt, so an agent told "ask" there would be nagging for nothing.
  const askable = access.origin !== null && access.source !== 'blocked';
  // Everything every branch carries, so no branch can forget a level and answer without one. The
  // annotation is what the levels are FOR: an object literal infers `need` as a plain `string`,
  // and a `need` that can be anything is the one field an agent reads to decide on spending a call.
  const common: Pick<AccessCheck, 'origin' | 'have' | 'need' | 'confirm' | 'askable' | 'hostGranted'> = {
    origin: access.origin,
    have,
    need: need ?? 'none',
    confirm,
    askable,
    hostGranted: input.hostGranted ?? null,
  };

  // Steps 1 and 2. `paused: false` is a FACT here, not a guess: `runMethod` runs `preflight` before
  // any handler and refuses EVERY method while paused, this one included, so a paused call never
  // reaches the function that would have had to report it. That refusal is the answer.
  const pre = preflight({ paused: false, features }, method);
  // The ONE feature, from the table `preflight` just read — so a refusal can be named without
  // reaching into a union whose `paused` branch has no feature at all, and without a second lookup
  // that could ever disagree with the gate.
  const feature: Feature = FEATURE_OF[method];
  const checked = { ...common, feature, featureOn: features[feature] === true };
  if (!pre.allow) {
    return { ...checked, allowed: false, stage: 'feature', reason: preflightMessage(pre, method) };
  }

  // Not a permission, so not part of the check order: a method this browser has no API for fails
  // whatever the person allows, and saying that first is the truer answer (issue #31).
  if (unsupported) {
    return {
      ...checked,
      allowed: false,
      stage: 'unsupported',
      reason: `${method} cannot run in this browser at all: ${unsupported}`,
    };
  }

  // Step 3. A method that touches no page (`tabs.list`, and `access.check` itself) needs no level,
  // so it passes here whatever the URL is; one that does needs it, and a URL that is not http(s) has
  // no origin and therefore no level — which is the same refusal, with the reason to match.
  if (need !== null && !atLeast(have, need)) {
    return {
      ...checked,
      allowed: false,
      stage: 'level',
      reason: access.origin
        ? `${access.origin} is at level "${have}" in Beifahrer and ${method} needs "${need}". ` +
          (askable
            ? 'Ask the person to raise it in the Beifahrer toolbar popup on that tab.'
            : 'The person blocked this site, so do not ask for it again unless they bring it up.')
        : `${method} is not possible on a non-web page (a browser-internal page, a local file or ` +
          `another extension's page) and needs "${need}".`,
    };
  }

  // Step 4. The level is high enough and the browser has not opened up this origin, which happens
  // when the permission was revoked after the level was set. A call would open the access prompt
  // here, so the answer is "not without the person" and never "yes".
  if (input.hostGranted === false) {
    return {
      ...checked,
      allowed: false,
      stage: 'grant',
      reason:
        `the browser has not granted Beifahrer access to ${access.origin}, so ${method} would ask the ` +
        'person first. They can allow it in the browser, or set the level again in the popup.',
    };
  }

  return {
    ...checked,
    allowed: true,
    stage: 'ok',
    reason: confirm
      ? `${method} would run here, and the person would confirm it first.`
      : `${method} would run here without asking.`,
  };
}
