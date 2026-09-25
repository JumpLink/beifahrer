import { browser } from '@wxt-dev/browser';
import { originOf, withRule, type Level } from '@beifahrer/core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../../src/bridge-client.ts';
import { t, type MessageKey } from '../../src/i18n.ts';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import {
  loadActivity,
  onToggle,
  renderActivity,
  setQuietly,
  type ActivitySnapshot,
} from '../../src/ui/features.ts';
import { heroIcon, stateOf, STATE_WORDS, type UiState } from '../../src/ui/status.ts';
import { renderSessions } from '../../src/ui/sessions.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const levels = $<Adw.ToggleGroup>('levels');
const confirmRow = $<Adw.SwitchRow>('confirm');
const toast = (text: string) => $<Adw.ToastOverlay>('toasts').addToast(text, { timeout: 3 });

/** The popup shows the newest few; the options page has the whole log. */
const ACTIVITY_SHOWN = 5;

const LEVEL_TIPS: Record<Level, MessageKey> = {
  none: 'level_none_tip',
  read: 'level_read_tip',
  write: 'level_write_tip',
};

/**
 * The banner speaks only when something is not normal, with the one action that fixes it.
 * "No agent running" is not a problem: agents start and stop, so it stays the hero's quiet word.
 */
const BANNERS: Partial<Record<UiState, { title: MessageKey; button: MessageKey }>> = {
  paused: { title: 'state_paused', button: 'action_resume' },
  unauthorized: { title: 'banner_unauthorized', button: 'action_pair' },
  protocol: { title: 'banner_protocol', button: 'action_settings' },
};

let state: UiState = 'unpaired';

function renderState(status: Status | undefined, paused: boolean, activity: ActivitySnapshot): void {
  state = stateOf(status, paused, activity);
  $('state').textContent = t(STATE_WORDS[state]);
  const icon = $<HTMLImageElement>('hero-icon');
  const src = `/icons/${heroIcon(state)}-48.png`;
  if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
  icon.classList.toggle('working', state === 'working');

  const pause = $<Gtk.Button>('pause');
  pause.setAttribute('icon-name', paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
  pause.setAttribute('tooltip-text', t(paused ? 'action_resume' : 'action_pause'));

  const banner = $<Adw.Banner>('banner');
  const spec = BANNERS[state];
  if (spec) {
    banner.setAttribute('title', t(spec.title));
    banner.setAttribute('button-label', t(spec.button));
  }
  banner.toggleAttribute('revealed', spec !== undefined);

  // Not paired yet: nothing below can do anything, so the first run is one clear step.
  const unpaired = state === 'unpaired';
  $('onboard').hidden = !unpaired;
  $('main').hidden = unpaired;
}

async function renderSite(origin: string | null): Promise<void> {
  const { policy } = await loadSettings();
  $('site').textContent = origin ?? t('site_none');
  $('site').classList.toggle('monospace', origin !== null);
  const rule = origin ? policy.origins[origin] : undefined;
  const level: Level = rule?.level ?? 'none';
  levels.hidden = !origin;
  levels.activeName = level;
  $('confirm-group').hidden = level !== 'write';
  setQuietly(confirmRow, rule?.confirmWrites !== false);
}

async function main(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const origin = originOf(tab?.url);

  // gjsify gap (unfixed, @gjsify/adwaita-web 0.52.0): <adw-toggle> has no tooltip, so the
  // explanation of each level goes on its rendered button as a native hover text.
  for (const button of levels.querySelectorAll<HTMLButtonElement>('button.adw-toggle')) {
    const name = (['none', 'read', 'write'] as const)[[...button.parentElement!.children].indexOf(button)];
    if (name) button.title = t(LEVEL_TIPS[name]);
  }

  const openOptions = (hash = '') => {
    if (!hash) return void browser.runtime.openOptionsPage();
    void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${hash}`) });
  };

  const refresh = async () => {
    const [status, activity, { paused }] = await Promise.all([
      browser.runtime.sendMessage({ type: 'status' }) as Promise<Status | undefined>,
      loadActivity(),
      loadSettings(),
    ]);
    renderState(status, paused, activity);
    renderSessions($<Adw.PreferencesGroup>('agents'), status);
    const count = renderActivity($<Adw.PreferencesGroup>('activity'), activity.log, {
      limit: ACTIVITY_SHOWN,
      onShowAll: () => openOptions('activity'),
      // Which session did it only says something when there is more than one.
      showSession: status?.state !== 'unpaired' && (status?.sessions.length ?? 0) > 1,
    });
    $('activity-empty').hidden = count !== 0;
  };
  await Promise.all([refresh(), renderSite(origin)]);
  // While the popup is open: follow the agent live, and a pause set from the page or shortcut.
  setInterval(() => void refresh(), 1000);
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void refresh();
  });

  levels.addEventListener('notify::active', async () => {
    if (!origin) return;
    const level = (levels.activeName ?? 'none') as Level;
    if (!(level in LEVEL_TIPS)) return;
    // permissions.request must be the FIRST await after the click: Firefox only accepts it while
    // the user gesture is still live, and any earlier await ends it. The toggle group notifies
    // synchronously inside its button's click (or key) handler, so the gesture is still live.
    if (level !== 'none') {
      const granted = await browser.permissions.request({ origins: [originPattern(origin)] });
      if (!granted) {
        await renderSite(origin);
        toast(t('access_denied'));
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
    await renderSite(origin);
  });

  onToggle(confirmRow, async (confirmWrites) => {
    if (!origin) return;
    const { policy } = await loadSettings();
    await saveSettings({ policy: withRule(policy, origin, { level: 'write', confirmWrites }) });
  });

  const setPaused = async (paused: boolean) => {
    await saveSettings({ paused });
    await refresh();
  };
  $('pause').addEventListener('click', () => void setPaused(state !== 'paused'));

  $('options').addEventListener('activated', () => openOptions());
  $('pair').addEventListener('click', () => openOptions());
  $('banner').addEventListener('button-clicked', () => {
    if (state === 'paused') void setPaused(false);
    else openOptions();
  });
}

void main();
