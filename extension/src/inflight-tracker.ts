/**
 * The count behind "no request still in flight": a number and a start time per request, in memory.
 * Pure, so the rules (what counts, what is too old, what a redirect is) are tested without a browser.
 */

import { SETTLE_INFLIGHT_WINDOW_MS } from '@beifahrer/core';

export const COUNTED = new Set(['main_frame', 'sub_frame', 'xmlhttprequest', 'fetch']);

/** A request whose end event never came (the worker slept, the tab died) is forgotten after this. */
const STALE_MS = 60_000;

export class InflightTracker {
  private readonly open = new Map<string, { tabId: number; at: number }>();

  start(requestId: string, tabId: number, at: number): void {
    // A redirect keeps its request id: the first start stands, the chain counts as one request.
    if (!this.open.has(requestId)) this.open.set(requestId, { tabId, at });
  }

  end(requestId: string): void {
    this.open.delete(requestId);
  }

  forgetTab(tabId: number): void {
    for (const [id, r] of this.open) if (r.tabId === tabId) this.open.delete(id);
  }

  /** Requests of the tab still open and younger than `windowMs`. */
  count(tabId: number, now: number, windowMs = SETTLE_INFLIGHT_WINDOW_MS): number {
    let n = 0;
    for (const [id, r] of this.open) {
      const age = now - r.at;
      if (age > STALE_MS) this.open.delete(id);
      else if (r.tabId === tabId && age <= windowMs) n++;
    }
    return n;
  }
}
