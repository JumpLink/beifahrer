import { browser } from '@wxt-dev/browser';
import { withRule, type Level } from '@beifahrer/core';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import { describeStatus } from '../../src/ui/status.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ALL = { origins: ['<all_urls>'] };

async function renderStatus(): Promise<void> {
  $('status').textContent = describeStatus(await browser.runtime.sendMessage({ type: 'status' }));
}

async function renderSites(): Promise<void> {
  const { policy } = await loadSettings();
  const table = $<HTMLTableElement>('sites');
  table.replaceChildren();
  const entries = Object.entries(policy.origins).sort(([a], [b]) => a.localeCompare(b));
  $('empty').hidden = entries.length > 0;
  for (const [origin, rule] of entries) {
    const row = table.insertRow();
    row.insertCell().textContent = origin;
    const select = document.createElement('select');
    for (const [value, label] of [
      ['read', 'Read'],
      ['write', 'Read + edit (ask)'],
      ['write-silent', 'Read + edit (don’t ask)'],
      ['none', 'Remove'],
    ]) {
      select.add(new Option(label, value));
    }
    select.value =
      rule.level === 'write' ? (rule.confirmWrites === false ? 'write-silent' : 'write') : rule.level;
    select.addEventListener('change', async () => {
      const v = select.value;
      if (v === 'none')
        await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
      const level: Level = v === 'write-silent' ? 'write' : (v as Level);
      const current = await loadSettings();
      await saveSettings({
        policy: withRule(
          current.policy,
          origin,
          level === 'write' ? { level, confirmWrites: v !== 'write-silent' } : { level },
        ),
      });
      await renderSites();
    });
    row.insertCell().append(select);
  }
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  ($('token') as HTMLInputElement).value = settings.token;
  ($('port') as HTMLInputElement).value = String(settings.port);
  ($('shots') as HTMLInputElement).checked = await browser.permissions.contains(ALL);

  $('save').addEventListener('click', async () => {
    await saveSettings({
      token: ($('token') as HTMLInputElement).value.trim(),
      port: Number(($('port') as HTMLInputElement).value),
    });
    await browser.runtime.sendMessage({ type: 'reconnect' });
    setTimeout(() => void renderStatus(), 800);
  });

  $('shots').addEventListener('change', async () => {
    const box = $('shots') as HTMLInputElement;
    // First await in the handler, for the same user-gesture reason as in the popup.
    const ok = box.checked ? await browser.permissions.request(ALL) : await browser.permissions.remove(ALL);
    box.checked = box.checked ? ok : !ok;
  });

  await renderStatus();
  await renderSites();
  setInterval(() => void renderStatus(), 3000);
}

void main();
