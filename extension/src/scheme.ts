/**
 * The colour scheme for a Chromium service worker, which has no `matchMedia` (ADR 0025 § 11). A
 * tiny offscreen document (`MATCH_MEDIA`, entrypoints/offscreen) reads it and reports it by
 * message; the answer is also kept in `storage.session`, so a worker that woke up has it before
 * the document answers again. Everything is feature-detected: no `chrome.offscreen` (Firefox,
 * Safari, an old Chromium) means no document and no answer, and the toolbar keeps its other ways.
 */

import { browser } from '@wxt-dev/browser';
import { SCHEME_QUERY, isSchemeMessage } from '@beifahrer/core';

interface OffscreenApi {
  createDocument(details: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

const KEY = 'colourSchemeDark';
const PAGE = 'offscreen.html';

const offscreen = (): OffscreenApi | null =>
  (globalThis as unknown as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen ?? null;

let dark: boolean | null = null;

/** What the offscreen document last reported; null until it has, or where there is none. */
export const reportedDark = (): boolean | null => dark;

async function ensureDocument(): Promise<void> {
  const api = offscreen();
  if (!api) return;
  try {
    await api.createDocument({
      url: PAGE,
      reasons: ['MATCH_MEDIA'],
      justification: "Reads the browser's colour scheme to draw the toolbar icon in a matching ink",
    });
  } catch {
    // Only one offscreen document may exist: "already exists" means it is up, ask it again.
    await browser.runtime.sendMessage({ type: SCHEME_QUERY }).catch(() => {});
  }
}

/**
 * Registered synchronously (MV3 wake-up). `onChange` runs when a report changed the answer; the
 * document is created or asked on every worker start.
 */
export function installScheme(onChange: () => void): void {
  if (!offscreen()) return;
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Only the extension's own offscreen document speaks for the colour scheme.
    if (!isSchemeMessage(message) || sender.url !== browser.runtime.getURL(`/${PAGE}`)) return undefined;
    if (message.dark !== dark) {
      dark = message.dark;
      void browser.storage.session.set({ [KEY]: dark }).catch(() => {});
      onChange();
    }
    return undefined;
  });
  void browser.storage.session
    .get(KEY)
    .then((stored) => {
      if (dark === null && typeof stored[KEY] === 'boolean') {
        dark = stored[KEY];
        onChange();
      }
    })
    .catch(() => {});
  void ensureDocument();
}
