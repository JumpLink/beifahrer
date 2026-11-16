/**
 * The history (ADR 0029): the extension's opt-in, local record of what the agent did.
 *
 * Lives in `storage.local` of this profile and nowhere else: no message returns it, the bridge never
 * sees it, nothing reads it to decide anything. Only the options page reads it (straight from
 * storage) and only the options page switches it on or clears it.
 *
 * What may be stored is decided in core (`historyEntry` builds from five inputs); this file only
 * decides WHEN, and the call site hands it nothing but those inputs.
 */

import { browser } from '@wxt-dev/browser';
import {
  historyEntry,
  parseHistory,
  pruneHistory,
  pushHistory,
  type HistoryEntry,
  type Method,
} from '@beifahrer/core';

export const HISTORY_KEY = 'history';
export const HISTORY_ENABLED_KEY = 'history_enabled';

export interface LocalArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Fail closed: only a literal `true` is on. A missing or malformed value is off. */
export const parseHistoryEnabled = (raw: unknown): boolean => raw === true;

const localArea = (): LocalArea => browser.storage.local as unknown as LocalArea;

/** The one thing a call site may hand over. Params, titles and session labels have no slot here. */
export interface HistoryInput {
  method: Method;
  url?: string | null;
  error?: { code: string } | null;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Append one entry if, and only if, the person switched the history on. Writes are chained: two
 * calls ending together would otherwise read the same list and one line would be lost. Never throws,
 * a lost line is better than a failed call.
 */
export function recordHistory(area: LocalArea, input: HistoryInput, now: number): Promise<void> {
  queue = queue.then(async () => {
    try {
      const raw = await area.get([HISTORY_ENABLED_KEY, HISTORY_KEY]);
      if (!parseHistoryEnabled(raw[HISTORY_ENABLED_KEY])) return;
      const entry = historyEntry({ at: now, method: input.method, url: input.url, error: input.error });
      await area.set({ [HISTORY_KEY]: pushHistory(parseHistory(raw[HISTORY_KEY]), entry, now) });
    } catch {
      // best effort only
    }
  });
  return queue;
}

export const recordCall = (input: HistoryInput): Promise<void> =>
  recordHistory(localArea(), input, Date.now());

/** What the options page shows: parsed, pruned, newest first. */
export async function readHistory(area: LocalArea, now: number): Promise<HistoryEntry[]> {
  const raw = await area.get(HISTORY_KEY);
  return pruneHistory(parseHistory(raw[HISTORY_KEY]), now);
}

export async function clearHistory(area: LocalArea): Promise<void> {
  await area.remove(HISTORY_KEY);
}

export async function historyEnabled(area: LocalArea): Promise<boolean> {
  return parseHistoryEnabled((await area.get(HISTORY_ENABLED_KEY))[HISTORY_ENABLED_KEY]);
}

export async function setHistoryEnabled(area: LocalArea, on: boolean): Promise<void> {
  await area.set({ [HISTORY_ENABLED_KEY]: on });
}

export const historyArea = localArea;
