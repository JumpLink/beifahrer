import { browser } from '@wxt-dev/browser';
import { originOf, withRule, withRuleQuiet, type Level, type OriginRule } from '@beifahrer/core';
import { GjsifyOptionList } from '@gjsify/adwaita-core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../../src/bridge-client.ts';
import { GRANTS_MESSAGE, type WideDuration, type WideView } from '../../src/grants-messages.ts';
import { browserInfo } from '../../src/browser-info.ts';
import { t, type MessageKey } from '../../src/i18n.ts';
import { WILDCARD_PATTERNS, loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import { renderBanner } from '../../src/ui/banner.ts';
import {
  loadActivity,
  onToggle,
  renderActivity,
  setQuietly,
  type ActivitySnapshot,
} from '../../src/ui/features.ts';
import { scriptQuietControl, type ScriptQuietControl } from '../../src/ui/script-quiet.ts';
import { heroIcon, stateOf, STATE_WORDS, type UiState } from '../../src/ui/status.ts';
import { showToast } from '../../src/ui/toast.ts';
import { renderSessions } from '../../src/ui/sessions.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const levels = $<Adw.ToggleGroup>('levels');
const confirmRow = $<Adw.SwitchRow>('confirm');
const toast = (text: string) => showToast(text, { timeout: 3 });

/** The origin the popup is about, read once in `main`; the site rows all write for it. */
let origin: string | null = null;

/** The script switch a stored rule carries, so writing another field cannot drop it. */
const quietFields = (rule: OriginRule | undefined): Pick<OriginRule, 'confirmScripts'> =>
  rule?.confirmScripts === false ? { confirmScripts: false } : {};

/** The site's own switch and its warning (ADR 0016), beside the "Ask before changes" row. */
const siteScripts: ScriptQuietControl = scriptQuietControl({
  row: $<Adw.SwitchRow>('confirm-scripts'),
  note: $<Adw.ActionRow>('confirm-scripts-note'),
  warning: $<Adw.ActionRow>('confirm-scripts-warning'),
  scope: 'site',
  save: async (quiet) => {
    if (!origin) return;
    const { policy } = await loadSettings();
    await saveSettings({
      policy: withRule(
        policy,
        origin,
        withRuleQuiet(policy.origins[origin] ?? { level: 'write' }, 'confirmScripts', !quiet),
      ),
    });
    await renderSite();
  },
});

/** The popup shows the newest few; the options page has the whole log. */
const ACTIVITY_SHOWN = 5;

const LEVEL_TIPS: Record<Level, MessageKey> = {
  none: 'level_none_tip',
  read: 'level_read_tip',
  write: 'level_write_tip',
};

let state: UiState = 'unpaired';

function renderState(
  status: Status | undefined,
  paused: boolean,
  activity: ActivitySnapshot,
  wide: boolean,
): void {
  state = stateOf(status?.state, paused, activity);
  $('state').textContent = t(STATE_WORDS[state]);
  const icon = $<HTMLImageElement>('hero-icon');
  const src = `/icons/${heroIcon(state, wide)}-48.png`;
  if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
  icon.classList.toggle('working', state === 'working');

  const pause = $<Gtk.Button>('pause');
  pause.setAttribute('icon-name', paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
  pause.setAttribute('tooltip-text', t(paused ? 'action_resume' : 'action_pause'));

  // The shared banner (src/ui/banner.ts): this page can act on every state it names.
  renderBanner($<Adw.Banner>('banner'), state, () => true);

  // Not paired yet: nothing below can do anything, so the first run is one clear step.
  const unpaired = state === 'unpaired';
  $('onboard').hidden = !unpaired;
  $('main').hidden = unpaired;
}

async function renderSite(): Promise<void> {
  const { policy, features } = await loadSettings();
  $('site').textContent = origin ?? t('site_none');
  $('site').classList.toggle('monospace', origin !== null);
  const rule = origin ? policy.origins[origin] : undefined;
  const level: Level = rule?.level ?? 'none';
  levels.hidden = !origin;
  levels.activeName = level;
  $('confirm-group').hidden = level !== 'write';
  setQuietly(confirmRow, rule?.confirmWrites !== false);
  // A script needs the feature AND the level, so a switch shown without either would promise a
  // thing the call could not do. `preflight` refuses the call itself (ADR 0012).
  siteScripts.setVisible(origin !== null && level === 'write' && features.script === true);
  siteScripts.render(rule?.confirmScripts === false);
}

// --- all sites, for a while (ADR 0010) ----------------------------------------------------

const wideLevel = $<Adw.ComboRow>('wide-level');
const wideFor = $<Adw.ComboRow>('wide-for');
const wideConfirm = $<Adw.SwitchRow>('wide-confirm');

// Assigned in `main`: the script switch is wired at module level, before the page has its state.
let refresh: () => Promise<void> = async () => {};

/**
 * The grant's own script switch (ADR 0016). It lives on the grant, so it ends with it and never
 * reaches the stored policy — the popup has one row for "all sites", and the background writes it
 * to every live wildcard at once.
 */
const wideScripts: ScriptQuietControl = scriptQuietControl({
  row: $<Adw.SwitchRow>('wide-scripts'),
  note: $<Adw.ActionRow>('wide-scripts-note'),
  warning: $<Adw.ActionRow>('wide-scripts-warning'),
  scope: 'wide',
  save: async (quiet) => {
    await browser.runtime.sendMessage({
      type: GRANTS_MESSAGE,
      op: 'quiet',
      confirmWrites: wideConfirm.active,
      confirmScripts: !quiet,
    });
    await refresh();
  },
});

/** The durations offered: an hour, until the browser closes, or one connected session. */
function renderWideChoices(status: Status | undefined): void {
  const sessions = status && status.state !== 'unpaired' ? status.sessions : [];
  const model = [
    { value: 'hour', label: t('wide_for_hour') },
    { value: 'browser', label: t('wide_for_browser') },
    ...sessions.map((s) => ({ value: `session:${s.port}`, label: s.label })),
  ];
  const key = JSON.stringify(model);
  if (wideFor.dataset.model === key) return;
  const keep = wideFor.selectedValue;
  wideFor.dataset.model = key;
  wideFor.model = GjsifyOptionList.new(model);
  wideFor.selectedValue = model.some((m) => m.value === keep) ? keep : 'hour';
}

function renderWide(view: WideView | null, status: Status | undefined, scriptFeature: boolean): void {
  $('wide-start').hidden = view !== null;
  $('wide-on').hidden = view === null;
  // Only where it decides something: a read grant has no writes to ask about, and a switch that
  // says "Ask before changes" over a grant that cannot change anything is a control that lies.
  const write = view !== null && view.level === 'write';
  wideConfirm.hidden = !write;
  // The same for scripts, and they need the feature switch as well: without it no script runs here
  // at all, whatever the grant allows.
  wideScripts.setVisible(write && scriptFeature);
  if (!view) return renderWideChoices(status);
  const level = t(view.level === 'write' ? 'level_write' : 'level_read');
  const left = view.until
    ? t('wide_left', Math.max(1, Math.ceil((view.until - Date.now()) / 60_000)))
    : t(view.session ? 'wide_for_session' : 'wide_for_browser');
  $('wide-on').setAttribute('subtitle', `${level} · ${left}`);
  // Absent means asking, so the switch is on unless the person turned it off. The same word the
  // site rule's own switch uses, because it is the same promise.
  setQuietly(wideConfirm, view.confirmWrites !== false);
  wideScripts.render(view.confirmScripts === false);
}

async function main(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  origin = originOf(tab?.url);

  // Safari grants host access per site, through its own prompt, and answers a request for every
  // site with `false` (measured on Safari 27.0.1, 2026-10-04). A button that can only fail is worse
  // than none, so "all sites" is not offered there.
  if ((await browserInfo()).family === 'safari') $('wide').hidden = true;

  const openOptions = (hash = '') => {
    if (!hash) return void browser.runtime.openOptionsPage();
    void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${hash}`) });
  };

  wideLevel.model = GjsifyOptionList.new([
    { value: 'read', label: t('level_read') },
    { value: 'write', label: t('level_write') },
  ]);
  wideLevel.selectedValue = 'read';

  refresh = async () => {
    const [status, activity, settings, wide] = await Promise.all([
      browser.runtime.sendMessage({ type: 'status' }) as Promise<Status | undefined>,
      loadActivity(),
      loadSettings(),
      browser.runtime.sendMessage({ type: GRANTS_MESSAGE, op: 'get' }) as Promise<WideView | null>,
    ]);
    renderState(status, settings.paused, activity, wide !== null);
    renderWide(wide, status, settings.features.script === true);
    renderSessions($<Adw.PreferencesGroup>('agents'), status);
    const count = renderActivity($<Adw.PreferencesGroup>('activity'), activity.log, {
      limit: ACTIVITY_SHOWN,
      onShowAll: () => openOptions('activity'),
      // Which session did it only says something when there is more than one.
      showSession: status?.state !== 'unpaired' && (status?.sessions.length ?? 0) > 1,
    });
    $('activity-empty').hidden = count !== 0;
  };
  await Promise.all([refresh(), renderSite()]);
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
        await renderSite();
        toast(t('access_denied'));
        return;
      }
    } else {
      await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
    }
    const { policy } = await loadSettings();
    // The script switch is carried over: raising the level says nothing about scripts, and dropping
    // the person's answer here would be the extension answering a question nobody asked.
    await saveSettings({
      policy: withRule(
        policy,
        origin,
        level === 'write'
          ? withRuleQuiet(
              { level, ...quietFields(policy.origins[origin]) },
              'confirmWrites',
              confirmRow.active,
            )
          : { level },
      ),
    });
    await renderSite();
  });

  onToggle(confirmRow, async (confirmWrites) => {
    if (!origin) return;
    const { policy } = await loadSettings();
    await saveSettings({
      policy: withRule(
        policy,
        origin,
        withRuleQuiet(
          { ...(policy.origins[origin] ?? { level: 'write' }), level: 'write' },
          'confirmWrites',
          confirmWrites,
        ),
      ),
    });
    await renderSite();
  });

  $('wide-allow').addEventListener('activated', async () => {
    // permissions.request must be the FIRST await after the click (Firefox's user gesture).
    const granted = await browser.permissions.request({ origins: WILDCARD_PATTERNS });
    if (!granted) return toast(t('access_denied'));
    const choice = wideFor.selectedValue;
    const duration: WideDuration = choice.startsWith('session:') ? 'session' : (choice as WideDuration);
    const started = await browser.runtime.sendMessage({
      type: GRANTS_MESSAGE,
      op: 'start',
      level: wideLevel.selectedValue === 'write' ? 'write' : 'read',
      duration,
      ...(duration === 'session' ? { port: Number(choice.slice('session:'.length)) } : {}),
    });
    if (!started) toast(t('wide_failed'));
    $<Adw.ExpanderRow>('wide-start').expanded = false;
    await refresh();
  });
  $('wide-end').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: GRANTS_MESSAGE, op: 'end' });
    await refresh();
  });
  // Both switches travel together: the background writes them to every live wildcard at once, so
  // sending one alone would let a malformed or stale value reset the other.
  onToggle(wideConfirm, async (confirmWrites) => {
    await browser.runtime.sendMessage({
      type: GRANTS_MESSAGE,
      op: 'quiet',
      confirmWrites,
      confirmScripts: wideScripts.row.active,
    });
    await refresh();
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
