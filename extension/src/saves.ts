/**
 * The file a page saves out of sight while a capture runs (ADR 0019).
 *
 * A save made like FileSaver does it clicks an `<a download href="blob:…">` that is not in the
 * document, so the page agent's click listener never sees it and the browser writes the file to the
 * person's Downloads folder. `downloads.onCreated` does see it, and it carries the blob's address.
 *
 * Four things about how this is built, each measured (probes/downloads, docs/traps-browser-platform.md):
 *
 * - **The listener exists only while a capture is armed.** `downloads` is an optional permission the
 *   person grants with the switch, so the API may not exist at load, and an event nobody asked for
 *   would be the extension watching the person's downloads for no reason. A capture keeps the worker
 *   alive for as long as it waits, so a listener added at its start is the one that hears the save.
 * - **Only a blob of the armed tab's own origin is taken** (`judgeSave`). The event carries no tab
 *   id in either engine, so the blob's origin is what ties a save to the page being captured. Every
 *   other download is left exactly as the browser made it.
 * - **The bytes are read first, the browser's copy is removed afterwards.** A page that revokes the
 *   blob right after `click()` leaves nothing to read; then the person keeps their file and the
 *   agent is told why it got nothing, instead of both losing it.
 * - **Cancel is not enough.** A small blob is complete before the event is delivered (both engines),
 *   and `cancel` of a finished download is an error in Firefox and a no-op in Chromium, so a file
 *   is left behind. `discard` waits for the download to settle and deletes the file if it exists.
 */

import { browser } from '@wxt-dev/browser';
import { describeDownload, judgeSave, type DownloadOutcome, type DownloadSnapshot } from '@beifahrer/core';

export interface Save {
  id: number;
  url: string;
}

interface DownloadItem extends DownloadSnapshot {
  id: number;
  url?: string;
}

interface DownloadsApi {
  onCreated: {
    addListener(fn: (item: DownloadItem) => void): void;
    removeListener(fn: (item: DownloadItem) => void): void;
  };
  cancel(id: number): Promise<void>;
  search(query: { id: number }): Promise<DownloadItem[]>;
  removeFile(id: number): Promise<void>;
  erase(query: { id: number }): Promise<number[]>;
}

/** The `downloads` surface, or null where the browser has none: the person has not granted it. */
function downloads(): DownloadsApi | null {
  const api = (browser as unknown as { downloads?: Partial<DownloadsApi> }).downloads;
  return api && api.onCreated && api.cancel && api.search && api.removeFile && api.erase
    ? (api as DownloadsApi)
    : null;
}

/** Whether the browser lets this extension see downloads at all. */
export function savesAvailable(): boolean {
  return downloads() !== null;
}

const SETTLE_BUDGET_MS = 3_000;

/** Wait until a download is no longer running; its last state, or null if the browser forgot it. */
async function settled(api: DownloadsApi, id: number): Promise<string | null> {
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  for (;;) {
    const state = (await api.search({ id }).catch(() => []))[0]?.state ?? null;
    if (state !== 'in_progress' || Date.now() >= deadline) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Watch for the save a capture's click starts on the tab whose address is `tabUrl`.
 *
 * `take` hands over the first matching save, once. Without the permission nothing is watched and
 * `take` never answers, which is what a capture on a browser that lacks the API should do: carry on
 * with the two ways it already had.
 */
export function watchSaves(tabUrl: string): {
  take(): Save | undefined;
  takeNative(): Save | undefined;
  finish(save: Save, waitMs: number): Promise<DownloadOutcome>;
  discard(save: Save): Promise<void>;
  stop(): void;
} {
  const api = downloads();
  const found: Save[] = [];
  const native: Save[] = [];
  const onCreated = (item: DownloadItem): void => {
    if (typeof item.url !== 'string') return;
    if (judgeSave(item.url, tabUrl).ok) {
      if (!found.length) found.push({ id: item.id, url: item.url });
    } else if (!native.length) {
      // Any other download that starts while the capture waits: only its state is reported (#126),
      // the event carries no tab id, so it may be one the person started elsewhere.
      native.push({ id: item.id, url: item.url });
    }
  };
  api?.onCreated.addListener(onCreated);
  return {
    take: () => found.shift(),
    takeNative: () => native.shift(),
    async finish(save, waitMs) {
      if (!api) return describeDownload(undefined, true);
      const deadline = Date.now() + waitMs;
      for (;;) {
        const item = (await api.search({ id: save.id }).catch(() => []))[0];
        const timedOut = Date.now() >= deadline;
        if ((item && item.state !== 'in_progress') || timedOut) return describeDownload(item, timedOut);
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    stop: () => api?.onCreated.removeListener(onCreated),
    async discard(save) {
      if (!api) return;
      await api.cancel(save.id).catch(() => undefined);
      if ((await settled(api, save.id)) === 'complete') await api.removeFile(save.id).catch(() => undefined);
      await api.erase({ id: save.id }).catch(() => undefined);
    },
  };
}
