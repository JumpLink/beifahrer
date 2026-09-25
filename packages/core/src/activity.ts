/**
 * The activity log the person sees in the popup: what the agent did in this browser, a line per
 * request. Pure, so that what may appear in it is decided and tested here.
 *
 * What a line holds, and what it never holds:
 * - the time, the method in words, the outcome (and for a refusal, why);
 * - which agent session asked (its label, ADR 0007);
 * - the HOST of the tab or URL — never a path, query or title, whatever the site's level;
 * - for a fill, the first few characters the agent typed (its own text, capped). Never page text:
 *   nothing a page returned is ever logged.
 *
 * The log lives in memory and session storage only (extension/src/activity.ts), never on disk.
 */

import type { Method } from './policy.ts';
import { hostOf } from './redact.ts';

export const ACTIVITY_LIMIT = 20;
export const PREVIEW_CHARS = 40;

export const METHOD_WORDS: Record<Method, string> = {
  'tabs.list': 'listed your tabs',
  'tabs.active': 'looked up the active tab',
  'page.read': 'read a page',
  'page.outline': 'outlined a page',
  'page.find': 'looked for an element',
  'page.wait': 'waited for a page',
  'page.screenshot': 'took a screenshot',
  'page.download': 'downloaded a document',
  'page.fill': 'filled a field',
  'page.click': 'clicked',
  'tabs.open': 'opened a tab',
  'tabs.move': 'moved tabs',
  'tabs.pin': 'pinned or unpinned tabs',
  'tabs.close': 'closed tabs',
  'tabs.group': 'grouped tabs',
  'tabs.ungroup': 'ungrouped tabs',
  'windows.create': 'opened a window',
  'sessions.save': 'saved a session',
  'sessions.list': 'listed saved sessions',
  'sessions.restore': 'restored a session',
  'sessions.delete': 'deleted a saved session',
  'sessions.define': 'defined a session',
  'sessions.recentlyClosed': 'listed recently closed windows',
  'sessions.restoreClosed': 'reopened a closed window',
};

export interface ActivityEntry {
  /** Milliseconds since the epoch. */
  at: number;
  method: Method;
  words: string;
  host: string | null;
  outcome: 'ok' | 'refused' | 'failed';
  /** For a refusal or failure: the wire error code, e.g. `paused`, `forbidden`, `denied`. */
  reason?: string;
  /** For a fill: the start of the agent's text, capped at PREVIEW_CHARS. */
  preview?: string;
  /** The label of the agent session that sent the request. */
  session?: string;
}

const REFUSALS = new Set(['paused', 'feature_disabled', 'forbidden', 'denied']);

export function activityEntry(input: {
  at: number;
  method: Method;
  params: unknown;
  /** The URL of the tab the method touched, or the URL it opened. Reduced to its host here. */
  url?: string | null;
  error?: { code: string } | null;
  session?: string;
}): ActivityEntry {
  const entry: ActivityEntry = {
    at: input.at,
    method: input.method,
    words: METHOD_WORDS[input.method] ?? input.method,
    host: hostOf(input.url),
    outcome: !input.error ? 'ok' : REFUSALS.has(input.error.code) ? 'refused' : 'failed',
  };
  if (input.error) entry.reason = input.error.code;
  if (input.session) entry.session = input.session;
  const text = (input.params as { text?: unknown } | null)?.text;
  if (input.method === 'page.fill' && typeof text === 'string') entry.preview = preview(text);
  return entry;
}

export function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/** Newest first, capped. */
export function pushActivity(log: readonly ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...log].slice(0, ACTIVITY_LIMIT);
}
