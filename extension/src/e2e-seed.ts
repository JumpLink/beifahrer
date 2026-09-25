import { browser } from '@wxt-dev/browser';
import { parseGrants } from '@beifahrer/core';
import { disconnectSession } from './bridge-client.ts';
import { answerAccessForTest, holdForPreview, type AccessScope } from './confirm.ts';
import { addGrant, endWildcard } from './grants.ts';

declare const __E2E_SEED__: string;

/** See scripts/build.ts: only an E2E build carries a seed; a release build compiles this to a no-op. */
export async function applyE2eSeed(): Promise<void> {
  if (!__E2E_SEED__) return;
  const existing = await browser.storage.local.get('token');
  if (existing.token) return;
  const { e2eGrants, e2eHostOrigins: _hosts, ...seed } = JSON.parse(__E2E_SEED__) as Record<string, unknown>;
  await browser.storage.local.set(seed);
  // Temporary grants the test starts with, as if the person had clicked "All sites" (ADR 0010).
  for (const grant of parseGrants(e2eGrants, Date.now())) await addGrant(grant);
}

/** A tab on this path stands in for the popup's Disconnect button, which a headless test cannot click. */
const DISCONNECT_PATH = /^http:\/\/127\.0\.0\.1:\d+\/__beifahrer_e2e\/disconnect\?port=(\d+)$/;
/** …for the answer buttons of an access prompt (ADR 0010). */
const ANSWER_PATH = /^http:\/\/127\.0\.0\.1:\d+\/__beifahrer_e2e\/answer\?scope=(once|session|always|deny)$/;
/** …for the popup's End on "All sites". */
const END_WIDE_PATH = /^http:\/\/127\.0\.0\.1:\d+\/__beifahrer_e2e\/end-wide$/;

/** The prompt may open a moment after the tab that answers it (a new session connects first). */
async function answerSoon(scope: AccessScope): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (answerAccessForTest(scope) > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * E2E builds only: the test opens `…/__beifahrer_e2e/disconnect?port=N` to press "Disconnect" on
 * the session of port N, and confirm.html#e2e-preview to see a confirmation. A release build
 * carries no seed and registers nothing.
 */
export function installE2eHooks(): void {
  if (!__E2E_SEED__) return;
  // confirm.html#e2e-preview shows this request (tests/e2e/ui-pages.mjs), synthetic like the fixture.
  holdForPreview({
    id: 'e2e-preview',
    origin: 'https://tickets.example',
    action: 'fill',
    target: 'textbox "Comment" (empty)',
    text: 'Fixed in 1.4.2, closing this ticket.',
  });
  // A tab reports its URL in several updates; each hook acts once per tab.
  const handled = new Set<string>();
  browser.tabs.onUpdated.addListener((tabId, _info, tab) => {
    const url = tab.url ?? '';
    if (!url.includes('/__beifahrer_e2e/') || handled.has(`${tabId} ${url}`)) return;
    handled.add(`${tabId} ${url}`);
    const port = DISCONNECT_PATH.exec(url)?.[1];
    if (port) disconnectSession(Number(port));
    const scope = ANSWER_PATH.exec(url)?.[1] as AccessScope | undefined;
    if (scope) void answerSoon(scope);
    if (END_WIDE_PATH.test(url)) void endWildcard();
  });
}
