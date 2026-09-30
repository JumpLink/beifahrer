/**
 * Which frames a tab has, and which origins the person allowed (issue #32).
 *
 * A cross-origin frame is a DIFFERENT origin from the page it sits in. The page's level does not
 * carry into it: an agent that may write on the page may not write on an embedded video player, a
 * comment widget or an ad frame, because granting the page does not grant the frames inside it. The
 * grant the person gives for an origin covers that origin wherever it appears, and a frame whose
 * origin is below `read` is simply not asked — the same as a tab the person blocked.
 *
 * The table is filled by the frames themselves. Each one announces its own URL on load, and the
 * browser attaches `sender.frameId` and `sender.url` to that message — so the frame list needs no
 * permission of its own, and the browser's own view of where a frame is is what gets recorded.
 *
 * It is a cache, and that is the honest name for it: a frame that navigates, is removed or goes
 * away leaves a stale row until its next announcement. Every read that uses it re-asks the frame, so
 * a stale row can only cost one `about:blank` section, never a wrong answer about a page.
 */

import { browser } from '@wxt-dev/browser';

export interface FrameRow {
  /** The browser's frame number. 0 is the page's own document and is never in the table. */
  frameId: number;
  /**
   * beifahrer's own number for this frame, 1, 2, 3 … in the order the frames announced themselves.
   *
   * This — not the browser's — is what goes into a ref, and that is not a cosmetic choice. Measured:
   * Firefox numbers a frame `10737418241`, and Chromium's numbers are small only by accident. A ref
   * is a token an agent reads, copies and compares ("frame 2, the second embed on the page"), so it
   * has to be short, ordered the way the page is, and stable while the tab lives. The browser's id
   * is none of those things: it is opaque, huge, and reassigned on navigation.
   */
  index: number;
  /** Where the frame says it is, as of its last announcement. */
  url: string;
  /** When it last said so, so rows can be dropped. */
  at: number;
}

/** How long a frame's announcement is taken for. A frame that lives longer re-announces on load. */
export const FRAME_TTL_MS = 5 * 60_000;

/** How many frames one tab may report. A page with forty iframes is a page, not an attack. */
export const MAX_FRAMES_PER_TAB = 40;

/**
 * A tab's frames, and the document they belong to.
 *
 * The URL is part of the key, and that is the point. Frame numbers are reassigned by the browser on
 * every navigation, and so are beifahrer's own — if the table outlived the document, an index from the
 * previous page would name a frame of THIS one, and a `b2e4` the agent was given before a navigation
 * would silently address a different element in a different document. Tying the table to the URL
 * makes that impossible: a ref from another document finds no row and is refused, which is the only
 * answer that is safe.
 */
interface FrameTable {
  /** The tab's URL when these frames were seen. */
  url: string;
  /** The next beifahrer frame number, so numbering restarts with the document. */
  next: number;
  rows: Map<number, FrameRow>;
}

const tables = new Map<number, FrameTable>();

/**
 * Record a frame that has just announced itself. `frameId` 0 is the page, which needs no row.
 *
 * `pageUrl` is the tab's own URL, and it is what the table is keyed by: a frame announcing itself
 * into a table that belongs to a previous document is a frame of this one, and its number has to be
 * numbered from scratch.
 */
export function noteFrame(tabId: number, frameId: number, url: string, pageUrl: string): void {
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId) || frameId <= 0) return;
  if (typeof url !== 'string' || url === '' || url.length > 4_000) return;
  const existing = tables.get(tabId);
  // A different document means a different set of frames and a numbering that starts again. Deciding
  // it HERE, on the announcement, is what keeps the two apart: `framesOf` re-checks it on every read,
  // so a ref from the previous document never finds a row even if no announcement has come yet.
  const table: FrameTable =
    existing && existing.url === pageUrl ? existing : { url: pageUrl, next: 0, rows: new Map() };
  tables.set(tabId, table);
  const known = table.rows.get(frameId);
  if (known) {
    known.url = url;
    known.at = Date.now();
    return;
  }
  // Past the cap the frame is simply not tracked: a page with forty embeds is a page, and a frame the
  // agent cannot address is better than a table that grows into a page's worth of requests.
  if (table.rows.size >= MAX_FRAMES_PER_TAB) return;
  const index = ++table.next;
  table.rows.set(frameId, { frameId, index, url, at: Date.now() });
  tables.set(tabId, table);
}

/**
 * Correct one row from the frame itself.
 *
 * The announcement is a hint (issue #32) and this is the correction: the frame answered `where` with
 * its own `location.href`, which is the only value the policy may be decided on. A row that is not
 * in the table is not created here — a frame has to announce itself once to be worth correcting, and
 * a `frameId` we have never seen announced is not one to act on.
 */
export function correctFrame(tabId: number, frameId: number, url: string): void {
  if (typeof url !== 'string' || url === '' || url.length > 4_000) return;
  const row = tables.get(tabId)?.rows.get(frameId);
  if (row) row.url = url;
}

/** Is this a URL a person can have a level for? `about:blank` and `data:` have no origin to ask. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Forget a tab's frames — on close. A navigation is handled by the URL the table is keyed by. */
export function forgetFrames(tabId: number): void {
  tables.delete(tabId);
}

/** The frame beifahrer calls `index` on, for the document the tab is on NOW. */
export function frameByIndex(tabId: number, index: number, pageUrl: string): FrameRow | undefined {
  return framesOf(tabId, pageUrl).find((row) => row.index === index);
}

/**
 * The frames of a tab that are worth asking, in the order they announced themselves, so the outline
 * and the text follow the order the page put them in as closely as a per-frame list can.
 */
export function framesOf(tabId: number, pageUrl: string): FrameRow[] {
  const table = tables.get(tabId);
  if (!table) return [];
  // A different document, so a different set of frames with a different numbering. Nothing here is
  // reused, and an index from the previous document simply does not resolve.
  if (table.url !== pageUrl) return [];
  const now = Date.now();
  const live: FrameRow[] = [];
  for (const row of table.rows.values()) {
    // Expired rows are dropped on the way out rather than by a timer: a background script that must
    // survive a service worker going to sleep keeps no interval alive, and a stale row costs one
    // wasted question, not a wrong answer.
    if (now - row.at > FRAME_TTL_MS) table.rows.delete(row.frameId);
    else live.push(row);
  }
  return live.sort((a, b) => a.index - b.index);
}

/** How many frames ever announced themselves, and what ids they carried. A counter, for diagnosis. */
export const seen: { hellos: number; ids: number[]; urls: string[] } = { hellos: 0, ids: [], urls: [] };

/** Did the person allow a frame's origin? The same question asked of a tab, with the same answer. */
export function framesOn(tabId: number, pageUrl: string, allowed: (url: string) => boolean): FrameRow[] {
  return framesOf(tabId, pageUrl).filter((row) => allowed(row.url));
}

/**
 * The browser's own listeners, so the table does not outlive what it describes.
 *
 * A closed tab is obvious and is all this has to do. A NAVATED tab is not cleaned up here, and
 * deliberately so: the next page gets its own frame numbers, and the answer to "which frames does
 * this document have" is the URL the table is keyed by, not a wipe at the right moment. A wipe would
 * be a race — a row could be dropped between an outline and the click that uses its ref, which is
 * exactly the `b2e5 is gone` refusal an agent should only get when the document really did change.
 */
export function installFrameCleanup(): void {
  browser.tabs.onRemoved.addListener((tabId: number) => forgetFrames(tabId));
}
