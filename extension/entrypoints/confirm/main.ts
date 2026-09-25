import { browser } from '@wxt-dev/browser';
import type { ConfirmRequest } from '../../src/confirm.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const id = location.hash.slice(1);

async function main(): Promise<void> {
  const req = (await browser.runtime.sendMessage({ type: 'confirm:get', id })) as ConfirmRequest | null;
  if (!req) {
    $('what').textContent = 'This request is no longer waiting.';
    ($('allow') as HTMLButtonElement).disabled = true;
    return;
  }
  $('origin').textContent = req.origin;
  $('what').textContent =
    req.action === 'fill' ? `Put this text into ${req.target}:` : `Click ${req.target}.`;
  if (req.text !== undefined) {
    $('text').hidden = false;
    $('text').textContent = req.text;
  }
  const answer = (allow: boolean) => async () => {
    await browser.runtime.sendMessage({
      type: 'confirm:answer',
      id,
      allow,
      remember: allow && ($('remember') as HTMLInputElement).checked,
    });
    window.close();
  };
  $('allow').addEventListener('click', answer(true));
  $('deny').addEventListener('click', answer(false));
  // Deny has the focus: Enter on a window that popped up unexpectedly must not approve anything.
  $('deny').focus();
}

void main();
