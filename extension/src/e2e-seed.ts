import { browser } from '@wxt-dev/browser';

declare const __E2E_SEED__: string;

/** See scripts/build.ts: only an E2E build carries a seed; a release build compiles this to a no-op. */
export async function applyE2eSeed(): Promise<void> {
  if (!__E2E_SEED__) return;
  const existing = await browser.storage.local.get('token');
  if (existing.token) return;
  await browser.storage.local.set(JSON.parse(__E2E_SEED__) as Record<string, unknown>);
}
