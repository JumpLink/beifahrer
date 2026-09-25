import { browser } from '@wxt-dev/browser';
import { disconnectSession } from './bridge-client.ts';

declare const __E2E_SEED__: string;

/** See scripts/build.ts: only an E2E build carries a seed; a release build compiles this to a no-op. */
export async function applyE2eSeed(): Promise<void> {
  if (!__E2E_SEED__) return;
  const existing = await browser.storage.local.get('token');
  if (existing.token) return;
  await browser.storage.local.set(JSON.parse(__E2E_SEED__) as Record<string, unknown>);
}

/** A tab on this path stands in for the popup's Disconnect button, which a headless test cannot click. */
const DISCONNECT_PATH = /^http:\/\/127\.0\.0\.1:\d+\/__beifahrer_e2e\/disconnect\?port=(\d+)$/;

/**
 * E2E builds only: the test opens `…/__beifahrer_e2e/disconnect?port=N` to press "Disconnect" on
 * the session of port N. A release build carries no seed and registers nothing.
 */
export function installE2eHooks(): void {
  if (!__E2E_SEED__) return;
  browser.tabs.onUpdated.addListener((_tabId, _info, tab) => {
    const port = DISCONNECT_PATH.exec(tab.url ?? '')?.[1];
    if (port) disconnectSession(Number(port));
  });
}
