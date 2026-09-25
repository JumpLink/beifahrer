import { browser } from '@wxt-dev/browser';
import { connect, currentStatus, install } from '../src/bridge-client.ts';
import { handleConfirmMessage, onWindowRemoved } from '../src/confirm.ts';
import { applyE2eSeed } from '../src/e2e-seed.ts';
import { activityLog, activityState } from '../src/activity.ts';
import { STOP_MESSAGE, installPauseCommand, setPaused } from '../src/indicator.ts';
import { installAutosave } from '../src/sessions-store.ts';
import { installToolbar } from '../src/toolbar.ts';

// Every listener is registered synchronously, at the top level: an MV3 service worker that wakes
// for an event only delivers it to listeners that exist before the first await.
install();
installAutosave();
installToolbar();
installPauseCommand();
browser.windows.onRemoved.addListener(onWindowRemoved);
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  // The one exception to "our own pages only": the Stop button of the in-page pill, which lives in
  // a content script. It can only PAUSE — the worst a forged stop does is stop the agent.
  if ((message as { type?: string } | null)?.type === STOP_MESSAGE) return setPaused(true);
  // Only our own pages (popup, options, confirm) may talk to the background this way. A content
  // script — the page agent — runs inside a web page and must never answer a confirmation.
  // `sender.tab` cannot tell them apart (the confirm window is a tab too); the sender's URL can:
  // for a content script it is the web page's.
  if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return undefined;
  const confirm = handleConfirmMessage(message);
  if (confirm) return confirm;
  if ((message as { type?: string } | null)?.type === 'status') return Promise.resolve(currentStatus());
  if ((message as { type?: string } | null)?.type === 'activity')
    return activityLog().then((log) => ({ log, ...activityState() }));
  if ((message as { type?: string } | null)?.type === 'reconnect')
    return connect().then(() => currentStatus());
  return undefined;
});
void applyE2eSeed().then(() => connect());
