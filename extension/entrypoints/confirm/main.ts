import { browser } from '@wxt-dev/browser';
import type { Gtk } from '@gjsify/adwaita-web';
import type { AccessScope, ConfirmRequest } from '../../src/confirm.ts';
import { t } from '../../src/i18n.ts';
import { originPattern } from '../../src/settings.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const id = location.hash.slice(1);

async function main(): Promise<void> {
  const req = (await browser.runtime.sendMessage({ type: 'confirm:get', id })) as ConfirmRequest | null;
  if (!req) {
    $('ask').hidden = true;
    $('gone').hidden = false;
    return;
  }
  $('where').setAttribute('subtitle', req.origin);
  if (req.action === 'access') return askAccess(req);
  $('what').textContent =
    req.action === 'fill'
      ? t('confirm_fill', req.target)
      : req.action === 'click'
        ? t('confirm_click', req.target)
        : t('confirm_close', req.target);
  if (req.action === 'close') {
    $('heading').textContent = t('confirm_heading_close');
    $('where-group').hidden = true;
    // Closing is the one answer here that cannot be taken back from this window.
    $('allow').removeAttribute('suggested');
    $('allow').toggleAttribute('destructive', true);
    $('items').hidden = false;
    for (const line of req.items ?? []) {
      const li = document.createElement('li');
      li.textContent = line;
      $('items').append(li);
    }
  }
  if (req.text !== undefined) {
    $('text').hidden = false;
    $('text').textContent = req.text;
  }
  // "Always allow" is the old "don't ask again" as a third answer: on a site it switches the
  // confirmation off for that origin, before closing tabs it switches that question off.
  const answer =
    (allow: boolean, remember = false) =>
    async () => {
      await browser.runtime.sendMessage({ type: 'confirm:answer', id, allow, remember });
      window.close();
    };
  $('allow').addEventListener('click', answer(true));
  $('always').addEventListener('click', answer(true, true));
  $('deny').addEventListener('click', answer(false));
  // Deny has the focus: Enter on a window that popped up unexpectedly must not approve anything.
  $<Gtk.Button>('deny').button.focus();
}

void main();

/**
 * "<session> wants to read <site>" (ADR 0010). Every yes asks the browser for the site's host
 * access in the same click, as the FIRST await (Firefox's user gesture); a browser that says no
 * turns the answer into a refusal.
 */
function askAccess(req: ConfirmRequest): void {
  const who = req.session || t('confirm_agent');
  $('heading').textContent = t('confirm_heading_access');
  document.title = t('confirm_heading_access');
  // Set as text: the session label comes from the bridge, the agent's side.
  $('what').textContent = t(
    req.level === 'write' ? 'confirm_access_write' : 'confirm_access_read',
    who,
    req.origin,
  );
  $('allow').setAttribute('label', t('confirm_allow_once'));
  $('always').setAttribute('label', t('confirm_always'));
  $('session').hidden = req.canScopeSession !== true;
  const answer = (scope: AccessScope) => async () => {
    let allow = scope !== 'deny';
    if (allow) allow = await browser.permissions.request({ origins: [originPattern(req.origin)] });
    await browser.runtime.sendMessage({
      type: 'confirm:answer',
      id,
      allow,
      remember: false,
      ...(allow || scope === 'deny' ? { scope } : {}),
    });
    window.close();
  };
  $('allow').addEventListener('click', answer('once'));
  $('session').addEventListener('click', answer('session'));
  $('always').addEventListener('click', answer('always'));
  $('deny').addEventListener('click', answer('deny'));
  $<Gtk.Button>('deny').button.focus();
}
