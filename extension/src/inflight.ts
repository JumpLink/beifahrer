/**
 * How many requests of a tab are still open — the background's half of "is the page quiet".
 *
 * Only a number and a start time per request, kept in memory: no URL, no header, nothing that could
 * be read back. That is why it is separate from the request log (network.ts), which is switched
 * off by default because its rows are a browsing history. This one answers a question about timing
 * and has no row to show.
 *
 * It needs `webRequest`, which is optional and the person's to grant. Where the API is missing
 * (not granted, or a browser without it) there are no events and the count stays 0, which makes
 * the wait rely on the page's own mutations alone. No permission is added for this.
 *
 * Only what moves a page counts: the documents and the XHR/fetch calls it makes. Images, fonts,
 * beacons and the like finish when they finish and change nothing the agent reads.
 */

import { browser } from '@wxt-dev/browser';
import { isTabId } from '@beifahrer/core';

import { COUNTED, InflightTracker, watchGrant } from './inflight-tracker.ts';

const tracker = new InflightTracker();
let installed = false;
let grantWatched = false;

/** Did a request of `tabId` start since `since`? Always false without the `webRequest` grant. */
export function requestsStartedSince(tabId: number, since: number): boolean {
  return tracker.startedSince(tabId, since);
}

/** Requests of `tabId` that are open now and young enough to count. */
export function pendingRequests(tabId: number): number {
  return tracker.count(tabId, Date.now());
}

interface Event {
  addListener(fn: (details: Record<string, unknown>) => void, filter: unknown): void;
}

/**
 * Attach the listeners where `webRequest` exists. Called at load, like `installNetworkWatch`: a
 * listener added later is not reliably delivered, and an MV3 worker that wakes has to find them.
 */
export function installInflightWatch(): void {
  if (!grantWatched) {
    grantWatched = true;
    // webRequest is optional: when the person grants it later, the listeners are attached then.
    watchGrant(
      (browser as unknown as { permissions?: Parameters<typeof watchGrant>[0] }).permissions,
      installInflightWatch,
    );
  }
  if (installed) return;
  const api = (
    browser as unknown as {
      webRequest?: { onBeforeRequest?: Event; onCompleted?: Event; onErrorOccurred?: Event };
    }
  ).webRequest;
  if (!api?.onBeforeRequest || !api.onCompleted || !api.onErrorOccurred) return;
  installed = true;
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  api.onBeforeRequest.addListener((d) => {
    if (!isTabId(d.tabId) || !COUNTED.has(String(d.type))) return;
    tracker.start(String(d.requestId ?? ''), d.tabId, Date.now());
  }, filter);
  const done = (d: Record<string, unknown>) => tracker.end(String(d.requestId ?? ''));
  api.onCompleted.addListener(done, filter);
  api.onErrorOccurred.addListener(done, filter);
  browser.tabs.onRemoved.addListener((tabId: number) => tracker.forgetTab(tabId));
}
