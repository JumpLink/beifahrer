import { browser } from '@wxt-dev/browser';
import { connect, currentStatus, install } from '../src/bridge-client.ts';
import { handleConfirmMessage, onWindowRemoved } from '../src/confirm.ts';
import { applyE2eSeed } from '../src/e2e-seed.ts';

// Every listener is registered synchronously, at the top level: an MV3 service worker that wakes
// for an event only delivers it to listeners that exist before the first await.
install();
browser.windows.onRemoved.addListener(onWindowRemoved);
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  // Only our own pages (popup, options, confirm) may talk to the background this way. A content
  // script — the page agent — runs inside a web page and must never answer a confirmation.
  // `sender.tab` cannot tell them apart (the confirm window is a tab too); the sender's URL can:
  // for a content script it is the web page's.
  if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return undefined;
  const confirm = handleConfirmMessage(message);
  if (confirm) return confirm;
  if ((message as { type?: string } | null)?.type === 'status') return Promise.resolve(currentStatus());
  if ((message as { type?: string } | null)?.type === 'reconnect')
    return connect().then(() => currentStatus());
  return undefined;
});
void applyE2eSeed().then(() => connect());
