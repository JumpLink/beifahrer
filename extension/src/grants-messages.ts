/**
 * The pages' side of the temporary grants (ADR 0010): the popup reads the live "all sites"
 * grant, starts one after the browser granted the host access in the click, sets whether its
 * writes ask, and ends it. Only extension pages reach this (background.ts checks the sender).
 */

import { browser } from '@wxt-dev/browser';
import { wildcardGrant, type Grant } from '@beifahrer/core';
import { addGrant, endWildcard, holdHosts, loadGrants, setWildcardQuiet, settle } from './grants.ts';
import { WILDCARD_PATTERNS } from './settings.ts';

export const GRANTS_MESSAGE = 'grants';

/** How long "all sites" lasts. None of them is permanent. */
export type WideDuration = 'hour' | 'browser' | 'session';

export const HOUR_MS = 60 * 60 * 1000;

export type GrantsRequest =
  | { type: typeof GRANTS_MESSAGE; op: 'get' }
  | {
      type: typeof GRANTS_MESSAGE;
      op: 'start';
      level: 'read' | 'write';
      duration: WideDuration;
      port?: number;
    }
  | { type: typeof GRANTS_MESSAGE; op: 'end' }
  | { type: typeof GRANTS_MESSAGE; op: 'quiet'; confirmWrites: boolean };

export interface WideView {
  level: 'read' | 'write';
  /** ms since the epoch; absent until the browser closes or the session ends. */
  until?: number;
  /** Bound to one agent session. */
  session: boolean;
  /** Absent means the person did not switch asking off, so every write opens the window. */
  confirmWrites?: boolean;
}

export async function handleGrantsMessage(
  message: unknown,
  sessionIdOf: (port: number) => string | undefined,
): Promise<WideView | null | boolean> {
  const m = message as Partial<{
    op: string;
    level: unknown;
    duration: unknown;
    port: unknown;
    confirmWrites: unknown;
  }>;
  if (m.op === 'get') {
    const g = wildcardGrant(await loadGrants(), Date.now());
    return g
      ? {
          level: g.level,
          ...(g.until ? { until: g.until } : {}),
          session: g.sessionId !== undefined,
          ...(g.confirmWrites !== undefined ? { confirmWrites: g.confirmWrites } : {}),
        }
      : null;
  }
  if (m.op === 'end') {
    await endWildcard();
    return true;
  }
  // Fail-closed like every other value read from a page: only `true` and `false` are answers,
  // and anything else leaves the stored grants exactly as they were.
  if (m.op === 'quiet') {
    if (typeof m.confirmWrites !== 'boolean') return false;
    await setWildcardQuiet(m.confirmWrites);
    return true;
  }
  if (m.op !== 'start') return false;
  // The popup asked the browser in the click; without its yes there is nothing to grant.
  if (!(await browser.permissions.contains({ origins: WILDCARD_PATTERNS }))) return false;
  // Held BEFORE anything can fail: a start that fails below gives the access straight back.
  await holdHosts({ wildcard: true });
  const grant = wideGrant(m.level, m.duration, m.port, sessionIdOf);
  if (!grant) {
    await settle();
    return false;
  }
  await addGrant(grant);
  return true;
}

function wideGrant(
  level: unknown,
  duration: unknown,
  port: unknown,
  sessionIdOf: (port: number) => string | undefined,
): Grant | null {
  if (level !== 'read' && level !== 'write') return null;
  if (duration === 'hour') return { scope: '*', level, until: Date.now() + HOUR_MS };
  if (duration === 'browser') return { scope: '*', level };
  if (duration !== 'session') return null;
  const sessionId = typeof port === 'number' ? sessionIdOf(port) : undefined;
  return sessionId ? { scope: '*', level, sessionId } : null;
}
