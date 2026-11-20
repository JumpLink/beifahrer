import { browser } from '@wxt-dev/browser';

declare const __E2E_SEED__: string;

/**
 * Open the options page once, right after the first install. Someone who installs the extension
 * from a store does not know yet that it needs the Beifahrer app; the options page shows the
 * connection diagram and where to get the app. An update or a browser restart opens nothing, and
 * neither does an E2E build, whose tests count the tabs they open.
 */
export function installWelcome(): void {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install' || __E2E_SEED__) return;
    void browser.runtime.openOptionsPage().catch(() => undefined);
  });
}
