/**
 * What the agent is doing in this browser right now, and what it did: the request counter behind
 * the toolbar badge and the log behind the popup's activity list.
 *
 * The log holds what `activityEntry` (core) lets through: time, method in words, host, outcome,
 * a capped preview of a fill. It lives in memory and, where the browser has it, in
 * `storage.session`, which survives an MV3 service worker going to sleep but never reaches disk.
 * Without `storage.session` it lives in memory only; a lost log is better than a stored one.
 */

import { browser } from '@wxt-dev/browser';
import {
  ACTIVITY_LIMIT,
  activityEntry,
  pushActivity,
  type ActivityEntry,
  type Method,
} from '@beifahrer/core';

const KEY = 'activity';

interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

let log: ActivityEntry[] = [];
let loaded = false;
let inFlight = 0;
let lastActivityAt = 0;
const listeners = new Set<() => void>();

function sessionArea(): SessionArea | null {
  return (browser.storage as unknown as { session?: SessionArea }).session ?? null;
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const stored = (await sessionArea()?.get(KEY))?.[KEY];
  if (Array.isArray(stored)) log = [...log, ...(stored as ActivityEntry[])].slice(0, ACTIVITY_LIMIT);
}

function changed(): void {
  for (const fn of listeners) fn();
}

export function onActivityChange(fn: () => void): void {
  listeners.add(fn);
}

export function activityState(): { inFlight: number; lastActivityAt: number } {
  return { inFlight, lastActivityAt };
}

export async function activityLog(): Promise<ActivityEntry[]> {
  await load();
  return log;
}

/** The URL a method touches, for the log's host column. Looked up before the method runs. */
async function urlOf(method: Method, params: unknown): Promise<string | null> {
  const p = params as { tabId?: unknown; url?: unknown } | null;
  if (method === 'tabs.open' && typeof p?.url === 'string') return p.url;
  if (typeof p?.tabId !== 'number') return null;
  // A tab id the agent made up, or one closed meanwhile, simply has no host to show; the method
  // itself answers not_found.
  return browser.tabs.get(p.tabId).then(
    (tab) => tab.url ?? null,
    () => null,
  );
}

/** Run one request and log it, refusals included. */
export async function track<T>(method: Method, params: unknown, run: () => Promise<T>): Promise<T> {
  inFlight++;
  changed();
  const url = await urlOf(method, params);
  let error: { code: string } | null = null;
  try {
    return await run();
  } catch (err) {
    error = { code: (err as { wire?: { code?: string } }).wire?.code ?? 'failed' };
    throw err;
  } finally {
    inFlight--;
    lastActivityAt = Date.now();
    await load();
    log = pushActivity(log, activityEntry({ at: lastActivityAt, method, params, url, error }));
    await sessionArea()?.set({ [KEY]: log });
    changed();
  }
}
