/**
 * Temporary grants (ADR 0010): "all sites" for a while, and the answers to an on-demand prompt.
 * The background owns them; the pages ask it by message (`GRANTS_*` in background.ts).
 *
 * Three rules make them temporary in fact, not only in name:
 *   - They live in `storage.session` (memory where a browser lacks it), so none survives a
 *     browser restart; the stored policy in `storage.local` never holds one.
 *   - Every decision checks the end time itself (`decide` in core); the alarm and timer below
 *     only clean up and repaint.
 *   - The browser host access requested for a grant is given back when the grant ends
 *     (`hostsToRelease`, core). Which access was requested for a grant is remembered in
 *     `storage.local`, because the browser keeps an optional permission across a restart that
 *     session storage does not survive: the next start finds it and removes it.
 */

import { browser } from '@wxt-dev/browser';
import {
  hostsToRelease,
  nextExpiry,
  parseGrants,
  pruneGrants,
  type Grant,
  type HeldHosts,
} from '@beifahrer/core';
import { WILDCARD_PATTERNS, loadSettings, originPattern } from './settings.ts';

export const GRANTS_ALARM = 'beifahrer-grants';
const GRANTS_KEY = 'temporaryGrants';
const HELD_KEY = 'heldHosts';

/** The extension's own ids of the agent sessions connected right now (bridge-client.ts). */
export const liveSessions = new Set<string>();

interface Area {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function sessionArea(): Area | null {
  return ((browser.storage as unknown as { session?: Area }).session ?? null) as Area | null;
}

/** Where a browser without `storage.session` keeps them: gone with the background page. */
let memory: unknown = [];

const listeners = new Set<() => void>();

/** Called whenever the grants change or one ends; the toolbar repaints from it. */
export function onGrantsChange(fn: () => void): void {
  listeners.add(fn);
}

/** The grants that are live now: well-formed, not run out, of a session that is still here. */
export async function loadGrants(now = Date.now()): Promise<Grant[]> {
  const area = sessionArea();
  const raw = area ? (await area.get(GRANTS_KEY))[GRANTS_KEY] : memory;
  return pruneGrants(parseGrants(raw, now), now, liveSessions);
}

async function storeGrants(grants: Grant[]): Promise<void> {
  const area = sessionArea();
  if (area) await area.set({ [GRANTS_KEY]: grants });
  else memory = grants;
}

async function loadHeld(): Promise<HeldHosts> {
  const raw = (await browser.storage.local.get(HELD_KEY))[HELD_KEY] as
    | { wildcard?: unknown; origins?: unknown }
    | undefined;
  const origins = Array.isArray(raw?.origins)
    ? raw.origins.filter((o): o is string => typeof o === 'string')
    : [];
  return { wildcard: raw?.wildcard === true, origins };
}

/** Remember that host access was requested for a grant, so its end gives it back. */
export function holdHosts(add: { wildcard?: boolean; origin?: string }): Promise<void> {
  return serial(async () => {
    const held = await loadHeld();
    const origins =
      add.origin && !held.origins.includes(add.origin) ? [...held.origins, add.origin] : held.origins;
    await browser.storage.local.set({
      [HELD_KEY]: { wildcard: held.wildcard || add.wildcard === true, origins },
    });
  });
}

/**
 * One change at a time: each reads the stored grants and writes them back, and two interleaved
 * would lose one's write.
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch(() => undefined);
  return next;
}

export function addGrant(grant: Grant): Promise<void> {
  return serial(async () => {
    // A newer grant of the same scope and session replaces the older one: its end is the one
    // the person just chose.
    const grants = (await loadGrants()).filter(
      (g) => !(g.scope === grant.scope && g.sessionId === grant.sessionId),
    );
    await storeGrants([...grants, grant]);
    await settleNow();
  });
}

/** The person's "End": every "all sites" grant goes, at once. */
export function endWildcard(): Promise<void> {
  return serial(async () => {
    await storeGrants((await loadGrants()).filter((g) => g.scope !== '*'));
    await settleNow();
  });
}

/** A session's connection closed: its grants end with it. */
export function endSession(sessionId: string): Promise<void> {
  liveSessions.delete(sessionId);
  return settle();
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Drop what ended, give the browser back the host access nothing needs any more, and schedule
 * the next clean-up. Safe to call any time; every start of the background calls it.
 */
export function settle(): Promise<void> {
  return serial(settleNow);
}

async function settleNow(): Promise<void> {
  const now = Date.now();
  const grants = await loadGrants(now);
  await storeGrants(grants);
  const [{ policy }, held] = await Promise.all([loadSettings(), loadHeld()]);
  const release = hostsToRelease(held, policy, grants, now, originPattern);
  if (release.wildcard) await browser.permissions.remove({ origins: WILDCARD_PATTERNS }).catch(() => false);
  if (release.origins.length > 0) {
    await browser.permissions
      .remove({ origins: [...new Set(release.origins.map(originPattern))] })
      .catch(() => false);
  }
  if (release.wildcard || release.origins.length > 0) {
    await browser.storage.local.set({
      [HELD_KEY]: {
        wildcard: held.wildcard && !release.wildcard,
        origins: held.origins.filter((o) => !release.origins.includes(o)),
      },
    });
  }
  const next = nextExpiry(grants);
  clearTimeout(timer);
  if (next !== null) {
    // The timer is exact while the background is awake; the alarm wakes a sleeping MV3 worker
    // (Chromium clamps it to 30 s, which is fine: the decision checks the end time itself).
    timer = setTimeout(() => void settle(), Math.max(next - now, 0) + 50);
    void browser.alarms.create(GRANTS_ALARM, { when: Math.max(next, now + 1_000) });
  } else {
    void browser.alarms.clear(GRANTS_ALARM);
  }
  for (const fn of listeners) fn();
}

/** Registered synchronously, like every listener of the background (MV3 wake-up). */
export function installGrants(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === GRANTS_ALARM) void settle();
  });
  // The policy changed (a site set to None, say): host access a grant held may be due back.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.policy) void settle();
  });
  void settle();
}
