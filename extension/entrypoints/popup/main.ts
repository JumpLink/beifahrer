import { browser } from '@wxt-dev/browser';
import { originOf, withRule, type Level } from '@beifahrer/core';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import { describeStatus } from '../../src/ui/status.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.levels button')];

const HINTS: Record<Level, string> = {
  none: 'The agent sees only that a tab on this site is open.',
  read: 'The agent may read this page, its outline and a screenshot. It cannot change anything.',
  write: 'The agent may also fill fields and click here.',
};

async function render(origin: string | null): Promise<void> {
  $('status').textContent = describeStatus(await browser.runtime.sendMessage({ type: 'status' }));
  const { policy } = await loadSettings();
  $('site').textContent = origin ?? 'not a web page — nothing to allow here';
  const rule = origin ? policy.origins[origin] : undefined;
  const level: Level = rule?.level ?? 'none';
  for (const b of buttons) {
    b.setAttribute('aria-pressed', String(b.dataset.level === level));
    b.disabled = !origin;
  }
  $('confirm-row').hidden = level !== 'write';
  ($('confirm') as HTMLInputElement).checked = rule?.confirmWrites !== false;
  $('hint').textContent = origin ? HINTS[level] : '';
}

async function main(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const origin = originOf(tab?.url);
  await render(origin);

  for (const b of buttons) {
    b.addEventListener('click', async () => {
      if (!origin) return;
      const level = b.dataset.level as Level;
      // permissions.request must be the FIRST await inside the click: Firefox only accepts it
      // while the user gesture is still live, and any earlier await ends it.
      if (level !== 'none') {
        const granted = await browser.permissions.request({ origins: [originPattern(origin)] });
        if (!granted) {
          $('hint').textContent = 'The browser did not grant access, so the level stays as it was.';
          return;
        }
      } else {
        await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
      }
      const { policy } = await loadSettings();
      const confirmWrites = ($('confirm') as HTMLInputElement).checked;
      await saveSettings({
        policy: withRule(policy, origin, level === 'write' ? { level, confirmWrites } : { level }),
      });
      await render(origin);
    });
  }

  $('confirm').addEventListener('change', async () => {
    if (!origin) return;
    const { policy } = await loadSettings();
    await saveSettings({
      policy: withRule(policy, origin, {
        level: 'write',
        confirmWrites: ($('confirm') as HTMLInputElement).checked,
      }),
    });
  });

  $('options').addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  });
}

void main();
