import { browser } from '@wxt-dev/browser';
import type { BrowserFamily } from '@beifahrer/core';

export interface BrowserInfo {
  family: BrowserFamily;
  name: string;
  version: string;
}

/**
 * Which browser this is. `runtime.getBrowserInfo` exists in Firefox only; everything else is read
 * off the user agent. Epiphany announces itself there, and it matters: it is the one engine with
 * a smaller API surface (see ADR 0001 § 3). Safari runs on the same WebKit extension engine
 * Epiphany is moving to.
 */
export async function browserInfo(): Promise<BrowserInfo> {
  const rt = browser.runtime as unknown as {
    getBrowserInfo?: () => Promise<{ name: string; version: string }>;
  };
  if (typeof rt.getBrowserInfo === 'function') {
    const info = await rt.getBrowserInfo();
    return { family: 'firefox', name: info.name, version: info.version };
  }
  const ua = navigator.userAgent;
  const epiphany = /Epiphany\/([\d.]+)/.exec(ua);
  if (epiphany) return { family: 'epiphany', name: 'Epiphany', version: epiphany[1] ?? '' };
  const brands = (
    navigator as unknown as { userAgentData?: { brands: { brand: string; version: string }[] } }
  ).userAgentData?.brands;
  const brand =
    brands?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ??
    brands?.find((b) => /Chromium/.test(b.brand));
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (brand || chrome) {
    return {
      family: 'chromium',
      name: brand?.brand ?? 'Chromium',
      version: brand?.version ?? chrome?.[1] ?? '',
    };
  }
  // Safari last: every engine above also says `Safari/` in its user agent. What only Safari
  // has is `Version/<n>` without a `Chrome/` token — and Epiphany, which shares both, returned
  // above.
  const safari = /Version\/([\d.]+).*Safari\//.exec(ua);
  if (safari) return { family: 'safari', name: 'Safari', version: safari[1] ?? '' };
  return { family: 'unknown', name: 'unknown', version: '' };
}

export function manifestVersion(): 2 | 3 {
  return browser.runtime.getManifest().manifest_version === 3 ? 3 : 2;
}
