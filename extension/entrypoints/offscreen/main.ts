import { browser } from '@wxt-dev/browser';
import { SCHEME_MESSAGE, SCHEME_QUERY } from '@beifahrer/core';

// A service worker has no `matchMedia`; this document, created with the MATCH_MEDIA reason, is
// where the worker reads `prefers-color-scheme` (src/scheme.ts). It reports the answer once, on
// every change, and whenever the worker asks again after a sleep.
const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
const report = (): void => {
  void browser.runtime.sendMessage({ type: SCHEME_MESSAGE, dark: query.matches }).catch(() => {});
};
query.addEventListener('change', report);
browser.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string } | null)?.type === SCHEME_QUERY) report();
  return undefined;
});
report();
