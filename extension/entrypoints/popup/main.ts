import { browser } from '@wxt-dev/browser';
import { originOf, withRule, type Level } from '@beifahrer/core';
import type { Adw } from '@gjsify/adwaita-web';
import type { Status } from '../../src/bridge-client.ts';
import { t } from '../../src/i18n.ts';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import {
  loadActivity,
  onToggle,
  renderActivity,
  renderFeatures,
  renderPause,
  setQuietly,
  wirePause,
} from '../../src/ui/features.ts';
import { describeStatus } from '../../src/ui/status.ts';
import { renderSessions } from '../../src/ui/sessions.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const levels = $<Adw.ToggleGroup>('levels');
const confirmRow = $<Adw.SwitchRow>('confirm');

const HINTS = { none: 'hint_none', read: 'hint_read', write: 'hint_write' } as const;

async function renderStatus(): Promise<void> {
  const status = (await browser.runtime.sendMessage({ type: 'status' })) as Status | undefined;
  $('status').textContent = describeStatus(status);
  renderSessions($<Adw.PreferencesGroup>('agents'), status);
  // A pairing problem is the one thing the person has to act on outside this popup: say it as a
  // banner with the way there. "No agent running" needs no action, so it stays the status line.
  const problem = $<Adw.Banner>('problem');
  const state = status?.state ?? 'unpaired';
  const banner = BANNERS[state as keyof typeof BANNERS];
  if (banner) problem.setAttribute('title', t(banner));
  problem.toggleAttribute('revealed', banner !== undefined);
}

const BANNERS = {
  unpaired: 'banner_unpaired',
  unauthorized: 'banner_unauthorized',
  protocol: 'banner_protocol',
} as const;

async function render(origin: string | null): Promise<void> {
  const { policy } = await loadSettings();
  $('site').textContent = origin ?? t('site_none');
  $('site').classList.toggle('monospace', origin !== null);
  const rule = origin ? policy.origins[origin] : undefined;
  const level: Level = rule?.level ?? 'none';
  levels.hidden = !origin;
  levels.activeName = level;
  $('confirm-group').hidden = level !== 'write';
  setQuietly(confirmRow, rule?.confirmWrites !== false);
  $('hint').textContent = origin ? t(HINTS[level]) : '';
}

async function main(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const origin = originOf(tab?.url);
  await Promise.all([renderStatus(), render(origin)]);

  levels.addEventListener('notify::active', async () => {
    if (!origin) return;
    const level = (levels.activeName ?? 'none') as Level;
    if (!(level in HINTS)) return;
    // permissions.request must be the FIRST await after the click: Firefox only accepts it while
    // the user gesture is still live, and any earlier await ends it. The toggle group notifies
    // synchronously inside its button's click (or key) handler, so the gesture is still live.
    if (level !== 'none') {
      const granted = await browser.permissions.request({ origins: [originPattern(origin)] });
      if (!granted) {
        await render(origin);
        $('hint').textContent = t('hint_denied');
        return;
      }
    } else {
      await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
    }
    const { policy } = await loadSettings();
    await saveSettings({
      policy: withRule(
        policy,
        origin,
        level === 'write' ? { level, confirmWrites: confirmRow.active } : { level },
      ),
    });
    await render(origin);
  });

  onToggle(confirmRow, async (confirmWrites) => {
    if (!origin) return;
    const { policy } = await loadSettings();
    await saveSettings({ policy: withRule(policy, origin, { level: 'write', confirmWrites }) });
  });

  const pause = $<Adw.SwitchRow>('pause');
  wirePause(pause);
  await renderPause(pause);
  // The row's own `title` attribute is its heading, so the hover text goes on its label column.
  pause.querySelector('.adw-row-text')?.setAttribute('title', t('pause_tooltip'));
  const features = $('features');
  await renderFeatures(features, true);
  const activity = $<Adw.PreferencesGroup>('activity');
  const refreshActivity = async () => renderActivity(activity, (await loadActivity()).log);
  await refreshActivity();
  // While the popup is open: follow the agent live, and a pause set from the page or shortcut.
  setInterval(() => void refreshActivity(), 1000);
  setInterval(() => void renderStatus(), 1000);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.paused) void renderPause(pause);
    if (changes.features || changes.grants) void renderFeatures(features, true);
  });

  const openOptions = () => void browser.runtime.openOptionsPage();
  $('options').addEventListener('activated', openOptions);
  $('problem').addEventListener('button-clicked', openOptions);
}

void main();
