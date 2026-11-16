/**
 * The history (ADR 0029): an opt-in, local, bounded record of what the agent did, kept longer than
 * the popup's last-20 activity log. Pure, so that what may be stored is decided and tested here.
 *
 * A line holds the time, the method's wire name, the HOST, the outcome and, for a refusal or
 * failure, the error code. Nothing else, by construction: `historyEntry` builds from five
 * inputs and `parseHistory` drops every other key, so a later writer cannot widen it by accident.
 * Never a path, query, title, argument, result, page text, session label or token.
 */

import { METHOD_WORDS, outcomeOf, type ActivityEntry } from './activity.ts';
import type { Method } from './policy.ts';
import { hostOf } from './redact.ts';

export const HISTORY_MAX_ENTRIES = 500;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface HistoryEntry {
  /** Milliseconds since the epoch. */
  at: number;
  method: Method;
  host: string | null;
  outcome: ActivityEntry['outcome'];
  /** The wire error code of a refusal or failure, e.g. `forbidden`. */
  reason?: string;
}

const REASON = /^[a-z][a-z0-9_]{0,31}$/;

function reasonOf(code: string): string {
  return REASON.test(code) ? code : 'failed';
}

export function historyEntry(input: {
  at: number;
  method: Method;
  /** The tab's or opened URL. Reduced to its host here; the rest is dropped. */
  url?: string | null;
  error?: { code: string } | null;
}): HistoryEntry {
  const entry: HistoryEntry = {
    at: input.at,
    method: input.method,
    host: hostOf(input.url),
    outcome: outcomeOf(input.error),
  };
  if (input.error) entry.reason = reasonOf(input.error.code);
  return entry;
}

function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && Object.hasOwn(METHOD_WORDS, value);
}

/** Fail closed, like `parsePolicy`: a malformed entry is dropped, never repaired; extra keys are cut. */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const item of raw) {
    const e = item as Record<string, unknown> | null;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
    if (!isMethod(e.method)) continue;
    if (e.outcome !== 'ok' && e.outcome !== 'refused' && e.outcome !== 'failed') continue;
    if (e.host !== null && typeof e.host !== 'string') continue;
    const entry: HistoryEntry = { at: e.at, method: e.method, host: e.host, outcome: e.outcome };
    if (typeof e.reason === 'string') entry.reason = reasonOf(e.reason);
    out.push(entry);
  }
  return out;
}

/** Newest first, older than the age cap dropped, then the count cap. */
export function pruneHistory(log: readonly HistoryEntry[], now: number): HistoryEntry[] {
  return log
    .filter((e) => now - e.at <= HISTORY_MAX_AGE_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_MAX_ENTRIES);
}

export function pushHistory(log: readonly HistoryEntry[], entry: HistoryEntry, now: number): HistoryEntry[] {
  return pruneHistory([entry, ...log], now);
}
