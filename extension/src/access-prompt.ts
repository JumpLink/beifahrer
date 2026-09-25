/**
 * Ask on demand (ADR 0010): when a call needs a site the agent has no level for, the person
 * gets "<session> wants to read <site>" instead of the agent getting `forbidden` at once.
 *
 * Fail closed at every step:
 *   - paused, the switch off in the options, or a site the person blocked: no prompt, a refusal;
 *   - no answer within the confirm timeout, a closed window, or Deny: a refusal;
 *   - the browser refusing the host permission (requested in the answer's own click, in the
 *     confirm window): a refusal.
 * One prompt per site and session at a time: a second call for the same pair waits on the
 * first prompt instead of opening another window. After a Deny the same session is not asked
 * for that site again until it reconnects.
 */

import { atLeast, withRule, type Level } from '@beifahrer/core';
import { askPerson, type AccessScope } from './confirm.ts';
import { addGrant, holdHosts } from './grants.ts';
import { loadSettings, saveSettings } from './settings.ts';

export interface Asker {
  /** The session's label, for the prompt's text. */
  label?: string;
  /** The extension's own id of the session's connection; absent for an unknown caller. */
  sessionId?: string;
}

interface Answer {
  scope: AccessScope | null;
  level: 'read' | 'write';
}

const pending = new Map<string, Promise<Answer>>();
const denied = new Set<string>();

const keyOf = (asker: Asker, origin: string) => `${asker.sessionId ?? ''}\n${origin}`;

/** Forget the Deny answers of a session that went away (bridge-client.ts). */
export function forgetDenials(sessionId: string): void {
  for (const key of denied) if (key.startsWith(`${sessionId}\n`)) denied.delete(key);
}

async function prompt(asker: Asker, origin: string, level: 'read' | 'write'): Promise<Answer> {
  const answer = await askPerson({
    origin,
    action: 'access',
    target: '',
    level,
    ...(asker.label ? { session: asker.label } : {}),
    canScopeSession: asker.sessionId !== undefined,
  });
  const scope = answer.allow ? (answer.scope ?? null) : answer.scope === 'deny' ? 'deny' : null;
  // "For this session" from a caller without a session would be a grant nobody can end.
  if (scope === 'session' && asker.sessionId === undefined) return { scope: null, level };
  if (scope === 'deny') return { scope, level };
  if (scope === 'once') await holdHosts({ origin });
  if (scope === 'session') {
    await holdHosts({ origin });
    await addGrant({ scope: origin, level, sessionId: asker.sessionId! });
  }
  if (scope === 'always') {
    const { policy } = await loadSettings();
    const rule = policy.origins[origin];
    const keep = rule && rule.level !== 'none' && atLeast(rule.level, level);
    if (!keep) {
      await saveSettings({
        policy: withRule(
          policy,
          origin,
          rule?.confirmWrites === false ? { level, confirmWrites: false } : { level },
        ),
      });
    }
  }
  return { scope, level };
}

/**
 * Ask the person for `need` on `origin`. The answer when they allowed it (once, for this
 * session or always), null for every kind of no. The caller checks the host grant again: the
 * browser may have refused it in the same click.
 */
export async function askForAccess(
  asker: Asker,
  origin: string,
  need: Level,
): Promise<Exclude<AccessScope, 'deny'> | null> {
  if (need === 'none') return null;
  const { paused, askOnDemand } = await loadSettings();
  if (paused || !askOnDemand) return null;
  const key = keyOf(asker, origin);
  // Two rounds at most: a call that needs `write` while a `read` prompt is open waits for that
  // answer, and asks again only if the answer did not cover it.
  for (let round = 0; round < 2; round++) {
    if (denied.has(key)) return null;
    let asking = pending.get(key);
    const mine = !asking;
    if (!asking) {
      asking = prompt(asker, origin, need).finally(() => pending.delete(key));
      pending.set(key, asking);
    }
    const answer = await asking;
    if (answer.scope === 'deny') denied.add(key);
    if (answer.scope === null || answer.scope === 'deny') return null;
    if (atLeast(answer.level, need)) {
      // Pause set while the window was open: the answer came too late to count.
      return (await loadSettings()).paused ? null : answer.scope;
    }
    if (mine) return null;
  }
  return null;
}
