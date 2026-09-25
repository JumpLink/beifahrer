/**
 * What the person configured, in `storage.local` of THIS browser profile.
 *
 * The policy lives here and nowhere else — the bridge never sees it, never stores it and cannot
 * change it. That is what "the browser is where the policy lives" in ADR 0001 means in code.
 */

import { browser } from '@wxt-dev/browser';
import {
  DEFAULT_PORT,
  EMPTY_POLICY,
  parseGrants,
  parsePolicy,
  type Grants,
  type Policy,
} from '@beifahrer/core';

export interface Settings {
  token: string;
  port: number;
  policy: Policy;
  /** Browser-level switches, e.g. "Let the agent manage tabs and windows". Off unless literally true. */
  grants: Grants;
  /** Ask before the agent closes tabs. Only a literal false switches asking off. */
  confirmClose: boolean;
  /** Keep automatic snapshots of the windows (ADR 0004). Only a literal false switches them off. */
  autosave: boolean;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get([
    'token',
    'port',
    'policy',
    'grants',
    'confirmClose',
    'autosave',
  ]);
  const port = Number(raw.port);
  return {
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    policy: raw.policy ? parsePolicy(raw.policy) : EMPTY_POLICY,
    grants: parseGrants(raw.grants),
    confirmClose: raw.confirmClose !== false,
    autosave: raw.autosave !== false,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(patch);
}

/**
 * The match pattern the browser's permission API wants for one origin.
 *
 * WITHOUT the port: Firefox does not honour a port in a host permission — `http://127.0.0.1:8080/*`
 * is reported as granted by `permissions.contains` and then refused by `executeScript` ("Missing
 * host permission for the tab"; measured, Firefox 155). The grant is therefore per host, which is
 * slightly wider than the policy's origin — and that is fine, because the policy (exact origin,
 * port included) is checked first and is the gate; the browser grant is the second fence.
 */
export function originPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}
