/**
 * Where the toolbar's ink gets a colour-scheme answer from, since the background context's own is
 * not reliable everywhere. A Chromium service worker has no `matchMedia` at all (ADR 0025 § 11):
 * a tiny offscreen document (`MATCH_MEDIA`, entrypoints/offscreen) reads it there and reports by
 * message, kept in `storage.session` so a worker that just woke has it before the document answers
 * again. A background PAGE (Safari, Firefox) does have `matchMedia`, but Safari's can go stale:
 * the page is kept alive for hours by the bridge's socket, and a LATER system appearance change
 * never reaches it — no `change` event, `.matches` frozen at load time (measured, incident
 * 2026-11-05/06, see the trap in docs/traps-browser-platform.md). So every freshly loaded
 * extension page (popup, options, confirm) also reports its own, always-current scheme
 * (`reportPageScheme`, called from each page's `main.ts`) — the SAME idea as the offscreen report,
 * just for the background-PAGE case instead of the worker case. `resolveSchemeDark` (core) prefers
 * that report once one exists; the one place this still leaves a gap is a scheme change while no
 * page is open and the background is a Safari page, which is why the trap entry names it as a
 * residual, not a secret. Everything here is feature-detected, never a UA check: no
 * `chrome.offscreen` means no offscreen document, and a page that never reports leaves the
 * background's own `matchMedia` (or, lacking one, the offscreen report) as the answer.
 */

import { browser } from '@wxt-dev/browser';
import { PAGE_SCHEME_MESSAGE, SCHEME_QUERY, isPageSchemeMessage, isSchemeMessage } from '@beifahrer/core';

interface OffscreenApi {
  createDocument(details: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

const KEY = 'colourSchemeDark';
const PAGE = 'offscreen.html';

const offscreen = (): OffscreenApi | null =>
  (globalThis as unknown as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen ?? null;

let dark: boolean | null = null;
let fromPage: boolean | null = null;

/** What the offscreen document last reported; null until it has, or where there is none. */
export const reportedDark = (): boolean | null => dark;

/** What the last live extension page reported (`reportPageScheme`); null until one has. */
export const reportedByPage = (): boolean | null => fromPage;

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
 * Registered synchronously (MV3 wake-up). `onChange` runs when either report changed the answer:
 * the offscreen document's (Chromium, Edge) or a live extension page's own
 * (`reportPageScheme`, every browser). The offscreen document is created or asked again on every
 * worker start; a page report needs nothing created, since a page reports on its own when it loads.
 */
export function installScheme(onChange: () => void): void {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Only the extension's own pages speak for the colour scheme, never a web page's content
    // script: `sender.url` for one of those is the web page's, never an extension URL.
    if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return undefined;
    if (isPageSchemeMessage(message)) {
      if (message.dark !== fromPage) {
        fromPage = message.dark;
        onChange();
      }
      return undefined;
    }
    // The offscreen document's own report, kept apart by its own message type and page.
    if (
      isSchemeMessage(message) &&
      sender.url === browser.runtime.getURL(`/${PAGE}`) &&
      message.dark !== dark
    ) {
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

/**
 * Called once by a freshly loaded extension page (popup, options, confirm): reports its OWN,
 * always-current `prefers-color-scheme`, now and again on every `change` — a page is never kept
 * alive the way Safari's background page is, so its `matchMedia` cannot go stale the same way.
 * A page may report only this boolean and nothing else (`isPageSchemeMessage` parses strictly).
 */
export function reportPageScheme(): void {
  const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return;
  const report = (): void => {
    void browser.runtime.sendMessage({ type: PAGE_SCHEME_MESSAGE, dark: query.matches }).catch(() => {});
  };
  query.addEventListener('change', report);
  report();
}
