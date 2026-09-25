/**
 * The background's side of the in-page pill (the pill itself: page-indicator.ts) and of the
 * pause switch, which the pill's Stop button, the popup and the keyboard shortcut all set.
 *
 * Resuming is possible only from the browser's own UI: the popup and the shortcut. No protocol
 * method touches `paused`, and a content script may only ever set it to true — so neither the
 * bridge nor a page can start the agent again.
 */

import { browser } from '@wxt-dev/browser';
import { loadSettings, saveSettings } from './settings.ts';

export { STOP_MESSAGE } from './page-messages.ts';

export async function setPaused(paused: boolean): Promise<void> {
  await saveSettings({ paused });
}

export async function togglePaused(): Promise<void> {
  await setPaused(!(await loadSettings()).paused);
}

/**
 * Ask the page agent in `tabId` to hide the pill, without injecting it: a tab it was never
 * injected into shows no pill, and `sendMessage` then rejects for want of a receiver.
 */
export async function hideIndicator(tabId: number): Promise<void> {
  await browser.tabs.sendMessage(tabId, { beifahrer: 'hide' }).catch(() => undefined);
}

/** The keyboard shortcut (manifest `commands`): pause or resume. Only the person can press it. */
export function installPauseCommand(): void {
  const commands = (browser as unknown as { commands?: typeof browser.commands }).commands;
  commands?.onCommand.addListener((command: string) => {
    if (command === 'toggle-pause') void togglePaused();
  });
}
