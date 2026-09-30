/**
 * The confirmation window for writes.
 *
 * A write the policy allows still needs the person's yes, unless they switched confirmation off
 * for that origin. The window is extension UI — a page cannot draw it, fake it or click it — and
 * it shows what will happen in plain words: where, which field, what text.
 *
 * The same window asks for ACCESS (ADR 0010): when a call needs a site the agent has no level
 * for, "<session> wants to read <site>" with Allow once, For this session, Always and Deny.
 *
 * No answer within two minutes is a no.
 */

import { browser } from '@wxt-dev/browser';
import { ASK_TIMEOUT_MS } from '@beifahrer/core';

export interface ConfirmRequest {
  id: string;
  /** The site a write goes to. Empty for `close`, which is about the browser, not one site. */
  origin: string;
  action: 'fill' | 'click' | 'press' | 'select' | 'check' | 'close' | 'access' | 'script';
  /** What is changed, or for `access` empty. */
  target: string;
  /** `access`: the level asked for. */
  level?: 'read' | 'write';
  /** `access`: the asking agent session's label, as the bridge reported it (untrusted text). */
  session?: string;
  /** `access`: whether "For this session" can be offered (the call came from a known session). */
  canScopeSession?: boolean;
  text?: string;
  /** `press`: the key, or the text to type — what the keys will be, in the person's own reading. */
  keys?: string;
  /** `press`: the keys are TEXT to type, not a key to press. The window says which, in words. */
  typed?: boolean;
  /** `select`: the option values or labels being chosen. */
  values?: string;
  /** `check`: `on` or `off`. A checkbox the person cannot see the new state of is not a decision. */
  state?: 'on' | 'off';
  /** `close`: one line per tab — host only for a tab the agent may not see. */
  items?: string[];
  /**
   * `script`: the code that is about to run, in full. Shown because a decision about code the
   * person cannot read is not a decision (ADR 0012). Never truncated: `parseEvaluate` refuses a
   * script too long to read before it ever reaches this window.
   */
  code?: string;
}

export interface ConfirmAnswer {
  allow: boolean;
  /**
   * "Always allow": turns `confirmWrites` off for the origin. For `close` it turns
   * `confirmClose` off.
   */
  remember: boolean;
  /** `access` only: which of the four answers the person gave. Absent for a timeout or a close. */
  scope?: AccessScope;
}

export type AccessScope = 'once' | 'session' | 'always' | 'deny';

const SCOPES: readonly AccessScope[] = ['once', 'session', 'always', 'deny'];

const TIMEOUT_MS = ASK_TIMEOUT_MS;

const pending = new Map<
  string,
  { req: ConfirmRequest; resolve: (a: ConfirmAnswer) => void; windowId?: number }
>();

export async function askPerson(req: Omit<ConfirmRequest, 'id'>): Promise<ConfirmAnswer> {
  const id = crypto.randomUUID();
  const full: ConfirmRequest = { ...req, id };
  return new Promise<ConfirmAnswer>((resolve) => {
    const settle = (answer: ConfirmAnswer) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(timer);
      if (entry.windowId !== undefined) browser.windows.remove(entry.windowId).catch(() => undefined);
      resolve(answer);
    };
    const timer = setTimeout(() => settle({ allow: false, remember: false }), TIMEOUT_MS);
    pending.set(id, { req: full, resolve: settle });
    browser.windows
      .create({
        url: browser.runtime.getURL(`/confirm.html#${id}`),
        type: 'popup',
        width: req.action === 'access' ? 560 : 520,
        height: req.action === 'access' ? 320 : 440,
      })
      .then((win) => {
        const entry = pending.get(id);
        if (entry && win?.id !== undefined) entry.windowId = win.id;
      })
      .catch(() => settle({ allow: false, remember: false }));
  });
}

/**
 * E2E builds only (e2e-seed.ts): a request that waits forever and opens no window, so the test
 * can open confirm.html on it and see the window as the person would.
 */
export function holdForPreview(req: ConfirmRequest): void {
  pending.set(req.id, { req, resolve: () => undefined });
}

/** Messages from confirm.html. Returns undefined for messages that are not ours. */
export function handleConfirmMessage(message: unknown): Promise<unknown> | undefined {
  const m = message as {
    type?: string;
    id?: string;
    allow?: boolean;
    remember?: boolean;
    scope?: unknown;
  } | null;
  if (!m || typeof m.id !== 'string') return undefined;
  if (m.type === 'confirm:get') return Promise.resolve(pending.get(m.id)?.req ?? null);
  if (m.type === 'confirm:answer') {
    const scope = SCOPES.find((s) => s === m.scope);
    pending
      .get(m.id)
      ?.resolve({ allow: m.allow === true, remember: m.remember === true, ...(scope ? { scope } : {}) });
    return Promise.resolve(true);
  }
  return undefined;
}

/** Closing the window is a no, not a hang. */
export function onWindowRemoved(windowId: number): void {
  for (const entry of pending.values()) {
    if (entry.windowId === windowId) entry.resolve({ allow: false, remember: false });
  }
}

/**
 * E2E builds only (e2e-seed.ts): answer an open confirmation as the person would press Allow or
 * Deny — for a fill, a click or a script (ADR 0012). `remember` is never set: no click in a test
 * stands for "don't ask me again". Returns how many windows it answered.
 */
export function answerConfirmForTest(allow: boolean): number {
  let answered = 0;
  for (const entry of pending.values()) {
    if (entry.req.action === 'access') continue;
    entry.resolve({ allow, remember: false });
    answered++;
  }
  return answered;
}

/**
 * E2E builds only (e2e-seed.ts): answer the open access prompts as if the person clicked
 * `scope`. The host permission a click would request is granted up front in an E2E build.
 * Returns how many prompts it answered.
 */
export function answerAccessForTest(scope: AccessScope): number {
  let answered = 0;
  for (const entry of pending.values()) {
    if (entry.req.action !== 'access') continue;
    entry.resolve({ allow: scope !== 'deny', remember: false, scope });
    answered++;
  }
  return answered;
}
