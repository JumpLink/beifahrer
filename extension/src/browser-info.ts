import { browser } from '@wxt-dev/browser';
import { browserFromUserAgent, type BrowserIdentity } from '@beifahrer/core';

export type BrowserInfo = BrowserIdentity;

/**
 * Which browser this is. `runtime.getBrowserInfo` exists in Firefox only, so Firefox is answered
 * here and everything else is read off the user agent — `browserFromUserAgent` (core), which is
 * pure and unit-tested without a browser.
 *
 * Why not the build target: a target says what to PACKAGE, not what is RUNNING. `chrome-mv3` and
 * `edge-mv3` ship the same bundle, and the person may have Chrome, Edge, Brave or a Chromium build
 * of their own, so the family has to come from the browser itself. That is why Edge reports
 * `chromium` with the name `Microsoft Edge` rather than a family of its own.
 *
 * Epiphany is answered on the user agent rather than through this API, and it matters: it is the
 * one engine with a smaller API surface (see ADR 0001 § 3). Safari runs on the same WebKit
 * extension engine Epiphany is moving to.
 */
export async function browserInfo(): Promise<BrowserInfo> {
  const rt = browser.runtime as unknown as {
    getBrowserInfo?: () => Promise<{ name: string; version: string }>;
  };
  if (typeof rt.getBrowserInfo === 'function') {
    const info = await rt.getBrowserInfo();
    return { family: 'firefox', name: info.name, version: info.version };
  }
  return browserFromUserAgent(
    navigator.userAgent,
    (navigator as unknown as { userAgentData?: { brands: { brand: string; version: string }[] } })
      .userAgentData?.brands,
  );
}

export function manifestVersion(): 2 | 3 {
  return browser.runtime.getManifest().manifest_version === 3 ? 3 : 2;
}
