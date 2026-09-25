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
 * a smaller API surface (see ADR 0001 § 3).
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
  return { family: 'unknown', name: 'unknown', version: '' };
}

export function manifestVersion(): 2 | 3 {
  return browser.runtime.getManifest().manifest_version === 3 ? 3 : 2;
}
