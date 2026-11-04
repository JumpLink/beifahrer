import { browser } from '@wxt-dev/browser';
import { SCHEME_MESSAGE, SCHEME_QUERY } from '@beifahrer/core';

// A service worker has no `matchMedia`; this document, created with the MATCH_MEDIA reason, is
// where the worker reads `prefers-color-scheme` (src/scheme.ts). It reports the answer once, on
// every change, and whenever the worker asks again after a sleep.
const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
let last: boolean | null = null;
const report = (force = false): void => {
  if (!force && query.matches === last) return;
  last = query.matches;
  void browser.runtime.sendMessage({ type: SCHEME_MESSAGE, dark: last }).catch(() => {});
};
query.addEventListener('change', () => report());
// Belt and braces: a document nobody renders may not get its `change` event (measured with a
// DevTools media override, which never fired it), so the answer is also re-read now and then.
setInterval(() => report(), 3000);
browser.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string } | null)?.type === SCHEME_QUERY) report(true);
  return undefined;
});
report(true);
