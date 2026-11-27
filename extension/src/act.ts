/**
 * After the agent acted on a tab: wait for the page to be quiet (settle.ts), from the background.
 *
 * The page answers for its own document (mutations), the background for the network (requests in
 * flight, inflight.ts) and for the tab (still loading). Neither half sees the other's, so the
 * background asks and combines — `runSettle` is the loop, this file the browser calls it needs.
 *
 * Every ask is gated again on where the tab is NOW: a write can move the tab to a site the person
 * never allowed, and a counter-only question still injects the agent into that page.
 */

import { browser } from '@wxt-dev/browser';
import {
  runSettle,
  verdictOf,
  type PageQuiet,
  type Probe,
  type SettleOptions,
  type SettleOutcome,
  type Verdict,
} from '@beifahrer/core';

import { pendingRequests } from './inflight.ts';
import { askPage } from './inject.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What a gated ask needs: the tab, and whether the policy lets `url` be looked at (`read`). */
export interface Scope {
  tabId: number;
  allows(url: string | undefined): boolean;
}

async function urlOf(tabId: number): Promise<string | undefined> {
  return (await browser.tabs.get(tabId).catch(() => undefined))?.url;
}

/** Wait for the top document of the tab to be quiet. Never throws: a page that cannot be asked is "cap". */
export async function settleTab(scope: Scope, options: SettleOptions = {}): Promise<SettleOutcome> {
  // A tab on a site below `read` is not asked at all: the loop is handed an immediate "quiet" so it
  // ends, and what it says about the page is nothing.
  const refused: PageQuiet = { doc: '', url: '', n: 0, ready: true, quiet: true };
  return runSettle(
    {
      now: () => Date.now(),
      sleep,
      ask: async (quietMs, maxMs) => {
        if (!scope.allows(await urlOf(scope.tabId))) return refused;
        const res = await askPage(scope.tabId, { beifahrer: 'quiet', quietMs, maxMs }).catch(() => undefined);
        return res?.ok ? (res.data as unknown as PageQuiet) : undefined;
      },
      inflight: () => pendingRequests(scope.tabId),
      loading: async () => (await browser.tabs.get(scope.tabId).catch(() => undefined))?.status === 'loading',
    },
    options,
  );
}

/** Where a document is NOW: the tab's address for the top document, the frame's own answer for a frame. */
async function whereIs(tabId: number, frame: number): Promise<string | undefined> {
  if (frame === 0) return urlOf(tabId);
  const res = await askPage(tabId, { beifahrer: 'where' }, frame).catch(() => undefined);
  const url = res?.ok ? res.data.url : undefined;
  return typeof url === 'string' ? url : undefined;
}

/**
 * One look at a document: which one it is, where, and how often it really changed. `blocked` says the
 * policy does not let this document be looked at now (it moved somewhere below `read`), and then
 * nothing was asked of it. A document that does not answer has no `probe`.
 */
export async function lookAt(
  scope: Scope,
  frame: number,
  ref?: string,
): Promise<{ probe?: Probe; url?: string; blocked: boolean }> {
  const url = await whereIs(scope.tabId, frame);
  if (!scope.allows(url)) return { blocked: true };
  const res = await askPage(scope.tabId, { beifahrer: 'probe', ...(ref ? { ref } : {}) }, frame).catch(
    () => undefined,
  );
  const p = res?.ok ? res.data : undefined;
  const probe =
    p && typeof p.doc === 'string' && typeof p.url === 'string' && typeof p.n === 'number'
      ? { doc: p.doc, url: p.url, n: p.n, ...(typeof p.f === 'string' ? { f: p.f } : {}) }
      : undefined;
  return { ...(probe ? { probe } : {}), ...(url ? { url } : {}), blocked: false };
}

/**
 * Did the write do anything? `before` was taken ahead of it; this settles the page, looks again and
 * compares. A document that moved to a site the person did not allow is "navigated" without its
 * address: the move already happened, and naming it would hand over a page the policy withholds.
 */
export async function judge(
  scope: Scope,
  frame: number,
  before: Probe | undefined,
  ref?: string,
): Promise<Verdict & { settled: 'quiet' | 'cap'; ms: number }> {
  const out = await settleTab(scope, frame === 0 && before ? { doc: before.doc } : {});
  const after = await lookAt(scope, frame, ref);
  const verdict: Verdict = after.blocked
    ? { change: 'navigated' }
    : verdictOf(before, after.probe, after.url);
  return { ...verdict, settled: out.settled, ms: out.ms };
}
