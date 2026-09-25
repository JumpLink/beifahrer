/**
 * Get the page agent into a tab and talk to it — one adapter over two APIs.
 *
 * MV3 (Chromium) has `scripting.executeScript`; MV2 (Firefox, Epiphany) has
 * `tabs.executeScript`. Both inject the same built file, `page-agent.js`, into the extension's
 * isolated world; the agent guards against a second injection itself, so injecting before every
 * request is cheap and always safe.
 */

import { browser } from 'wxt/browser';
import type { PageRequest, PageResponse } from './page-messages.ts';

const FILE = '/page-agent.js';

export async function inject(tabId: number): Promise<void> {
  const scripting = (browser as unknown as { scripting?: typeof browser.scripting }).scripting;
  if (scripting?.executeScript) {
    await scripting.executeScript({ target: { tabId }, files: [FILE] });
    return;
  }
  const tabs = browser.tabs as unknown as {
    executeScript?: (tabId: number, details: { file: string }) => Promise<unknown>;
  };
  if (typeof tabs.executeScript !== 'function') throw new Error('this browser can inject no script');
  await tabs.executeScript(tabId, { file: FILE });
}

export async function askPage<T extends PageRequest>(tabId: number, req: T): Promise<PageResponse> {
  await inject(tabId);
  const res = (await browser.tabs.sendMessage(tabId, req)) as PageResponse | undefined;
  if (!res) throw new Error('the page did not answer');
  return res;
}
