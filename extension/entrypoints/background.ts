import { browser } from '@wxt-dev/browser';
import { isFrameHello } from '@beifahrer/core';
import { connect, currentStatus, disconnectSession, install, sessionIdOf } from '../src/bridge-client.ts';
import { handleConfirmMessage, onWindowRemoved } from '../src/confirm.ts';
import { applyE2eSeed, installE2eHooks } from '../src/e2e-seed.ts';
import { activityLog, activityState } from '../src/activity.ts';
import { STOP_MESSAGE, installPauseCommand, setPaused } from '../src/indicator.ts';
import { GRANTS_MESSAGE, handleGrantsMessage } from '../src/grants-messages.ts';
import { installGrants } from '../src/grants.ts';
import { installFrameCleanup, noteFrame } from '../src/frames.ts';
import { installAutosave } from '../src/sessions-store.ts';
import { installToolbar } from '../src/toolbar.ts';
import { DISCONNECT_MESSAGE } from '../src/ui/sessions.ts';

// Every listener is registered synchronously, at the top level: an MV3 service worker that wakes
// for an event only delivers it to listeners that exist before the first await.
install();
installAutosave();
installToolbar();
installPauseCommand();
installGrants();
installE2eHooks();
installFrameCleanup();
browser.windows.onRemoved.addListener(onWindowRemoved);
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  // The one exception to "our own pages only": the Stop button of the in-page pill, which lives in
  // a content script. It can only PAUSE — the worst a forged stop does is stop the agent.
  if ((message as { type?: string } | null)?.type === STOP_MESSAGE) return setPaused(true);
  // A frame saying where it is (issue #32). The one other thing a content script may send
  // unprompted, and it asks for nothing: the extension pairs the message with the browser's own
  // `frameId` and decides afterwards whether the person's policy for THAT origin lets the agent
  // read it. It is read before the own-pages check below because it necessarily comes from a web
  // page — and because a frame that is not answered simply is not asked again.
  if (isFrameHello(message)) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    // The tab's own URL is part of the key: a frame announcing itself into a table that belongs to a
    // previous document is a frame of THIS one, and its number has to be numbered from scratch.
    if (typeof tabId === 'number')
      noteFrame(tabId, frameId, message.url, sender.tab?.url ?? sender.url ?? '');
    // Answered with the number the BROWSER gave us for this message. A frame needs to know its own
    // address to drop a request meant for a different one, and only the extension can tell it: a
    // frame cannot work out its own frame number from inside itself.
    return Promise.resolve({ frame: frameId });
  }
  // Only our own pages (popup, options, confirm) may talk to the background this way. A content
  // script — the page agent — runs inside a web page and must never answer a confirmation.
  // `sender.tab` cannot tell them apart (the confirm window is a tab too); the sender's URL can:
  // for a content script it is the web page's.
  if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return undefined;
  const confirm = handleConfirmMessage(message);
  if (confirm) return confirm;
  if ((message as { type?: string } | null)?.type === 'status') return Promise.resolve(currentStatus());
  if ((message as { type?: string } | null)?.type === GRANTS_MESSAGE)
    return handleGrantsMessage(message, sessionIdOf);
  if ((message as { type?: string } | null)?.type === 'activity')
    return activityLog().then((log) => ({ log, ...activityState() }));
  const m = message as { type?: string; port?: unknown } | null;
  if (m?.type === DISCONNECT_MESSAGE && typeof m.port === 'number')
    return Promise.resolve(disconnectSession(m.port));
  if ((message as { type?: string } | null)?.type === 'reconnect')
    return connect().then(() => currentStatus());
  return undefined;
});
void applyE2eSeed().then(() => connect());
