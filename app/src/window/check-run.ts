/**
 * Runs the check (ADR 0017 § 7): a short session of its own that asks every connected browser for
 * `tabs.list` and ends. It is an ordinary agent session in every way that matters: it binds its own
 * loopback port, the extension finds it like any other, and the call passes the extension's gates
 * (paused, feature, site level). Nothing here sets, lifts or reads a policy; a refusal comes back as
 * the answer it is. No GTK, so the Node unit tests reach it.
 */

import type { BridgeStatus } from '@beifahrer/core';

import { BridgeError } from '../bridge/bridge.ts';
import type { CheckResult, Refusal } from './check-model.ts';

/** What the check needs of a bridge. `Bridge` satisfies it; a test passes a small fake. */
export interface CheckBridge {
  status(): BridgeStatus;
  waitForConnection(timeoutMs: number): Promise<unknown>;
  call(method: 'tabs.list', params: Record<string, never>, browser?: string): Promise<{ tabs: unknown[] }>;
  stop(): Promise<void>;
}

/** The extension finds a new bridge within a few probe rounds that back off up to 5 s each. */
export const CHECK_WAIT_MS = 10_000;

interface Outcome {
  name: string;
  tabs?: number;
  error?: unknown;
}

function refusalOf(err: unknown): Refusal | null {
  if (!(err instanceof BridgeError)) return null;
  switch (err.wire.code) {
    case 'paused':
      return 'paused';
    case 'feature_disabled':
      return 'feature_disabled';
    case 'forbidden':
    case 'denied':
      return 'refused';
    default:
      return null;
  }
}

/** One browser that answered makes the check an answer; otherwise the first refusal is shown. */
export function summarize(outcomes: readonly Outcome[]): CheckResult {
  const answered = outcomes.filter((o) => o.tabs !== undefined);
  if (answered.length > 0) {
    return {
      kind: 'answered',
      browsers: answered.map((o) => o.name),
      tabs: answered.reduce((sum, o) => sum + (o.tabs ?? 0), 0),
    };
  }
  for (const o of outcomes) {
    const reason = refusalOf(o.error);
    if (reason) return { kind: 'refused', reason, browsers: [o.name] };
  }
  const first = outcomes[0]?.error;
  return { kind: 'failed', reason: first instanceof Error ? first.message : String(first) };
}

export async function runCheck(
  open: () => Promise<CheckBridge>,
  waitMs: number = CHECK_WAIT_MS,
): Promise<CheckResult> {
  let bridge: CheckBridge;
  try {
    bridge = await open();
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
  try {
    await bridge.waitForConnection(waitMs).catch(() => undefined);
    const browsers = bridge.status().browsers;
    if (browsers.length === 0) return { kind: 'nobrowser' };
    // By connection id: with two browsers a bare call is refused as ambiguous, and each one should answer for itself.
    const outcomes = await Promise.all(
      browsers.map(async (b): Promise<Outcome> => {
        const name = `${b.browser.name} ${b.browser.version}`;
        try {
          return { name, tabs: (await bridge.call('tabs.list', {}, b.id)).tabs.length };
        } catch (error) {
          return { name, error };
        }
      }),
    );
    return summarize(outcomes);
  } finally {
    await bridge.stop().catch(() => undefined);
  }
}
