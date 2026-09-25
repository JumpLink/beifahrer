/**
 * The confirmation window for writes.
 *
 * A write the policy allows still needs the person's yes, unless they switched confirmation off
 * for that origin. The window is extension UI — a page cannot draw it, fake it or click it — and
 * it shows what will happen in plain words: where, which field, what text.
 *
 * No answer within two minutes is a no.
 */

import { browser } from '@wxt-dev/browser';

export interface ConfirmRequest {
  id: string;
  origin: string;
  action: 'fill' | 'click';
  target: string;
  text?: string;
}

export interface ConfirmAnswer {
  allow: boolean;
  /** "Don't ask again on this site" — turns `confirmWrites` off for the origin. */
  remember: boolean;
}

const TIMEOUT_MS = 120_000;

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
      .create({ url: browser.runtime.getURL(`/confirm.html#${id}`), type: 'popup', width: 520, height: 440 })
      .then((win) => {
        const entry = pending.get(id);
        if (entry && win?.id !== undefined) entry.windowId = win.id;
      })
      .catch(() => settle({ allow: false, remember: false }));
  });
}

/** Messages from confirm.html. Returns undefined for messages that are not ours. */
export function handleConfirmMessage(message: unknown): Promise<unknown> | undefined {
  const m = message as { type?: string; id?: string; allow?: boolean; remember?: boolean } | null;
  if (!m || typeof m.id !== 'string') return undefined;
  if (m.type === 'confirm:get') return Promise.resolve(pending.get(m.id)?.req ?? null);
  if (m.type === 'confirm:answer') {
    pending.get(m.id)?.resolve({ allow: m.allow === true, remember: m.remember === true });
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
