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
import { runSettle, type PageQuiet, type SettleOptions, type SettleOutcome } from '@beifahrer/core';

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
