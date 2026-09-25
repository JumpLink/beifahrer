import { browser } from '@wxt-dev/browser';
import {
  AUTOSAVE_PREFIX,
  FEATURES,
  FEATURE_OF,
  MAX_NAME,
  hostOf,
  sessionNameIssue,
  upsertSession,
  withRule,
  type Level,
  type Method,
  type SavedSession,
  type SessionNameIssue,
} from '@beifahrer/core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../../src/bridge-client.ts';
import { featureLabel, plural, t, uiLanguage, type MessageKey } from '../../src/i18n.ts';
import { toggleShortcut } from '../../src/shortcut.ts';
import {
  capture,
  loadSessions,
  restoreSession,
  sessionsApi,
  updateSessions,
} from '../../src/sessions-store.ts';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import {
  hoverText,
  loadActivity,
  markEmpty,
  onToggle,
  renderActivity,
  renderFeatures,
  setFeature,
  setQuietly,
  switchRowIcon,
} from '../../src/ui/features.ts';
import { infoButton } from '../../src/ui/info.ts';
import { heroIcon, stateOf, STATE_WORDS, type UiState } from '../../src/ui/status.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ALL = { origins: ['<all_urls>'] };
const toast = (text: string, options: { buttonLabel?: string; onAction?: () => void } = {}) =>
  $<Adw.ToastOverlay>('toasts').addToast(text, { timeout: 4, ...options });

const status = async () => (await browser.runtime.sendMessage({ type: 'status' })) as Status | undefined;

// --- state: header word and banner ----------------------------------------------------------

let state: UiState = 'unpaired';

/** The banner speaks only when something is not normal, with the one action that fixes it. */
const BANNERS: Partial<Record<UiState, { title: MessageKey; button?: MessageKey }>> = {
  paused: { title: 'state_paused', button: 'action_resume' },
  unauthorized: { title: 'banner_unauthorized' },
  protocol: { title: 'banner_protocol' },
};

async function renderState(): Promise<void> {
  const [current, activity, { paused }] = await Promise.all([status(), loadActivity(), loadSettings()]);
  state = stateOf(current, paused, activity);
  $('state').textContent = t(STATE_WORDS[state]);
  const icon = $<HTMLImageElement>('hero-icon');
  const src = `/icons/${heroIcon(state)}-48.png`;
  if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
  icon.classList.toggle('working', state === 'working');
  setQuietly($<Adw.SwitchRow>('pause'), paused);

  const banner = $<Adw.Banner>('banner');
  const spec = BANNERS[state];
  if (spec) {
    banner.setAttribute('title', t(spec.title));
    if (spec.button) banner.setAttribute('button-label', t(spec.button));
    else banner.removeAttribute('button-label');
  }
  banner.toggleAttribute('revealed', spec !== undefined);
  renderActivity($<Adw.PreferencesGroup>('activity'), activity.log);
  markEmpty($<Adw.PreferencesGroup>('activity'), activity.log.length === 0 ? t('activity_empty') : null);
}

async function setupPause(): Promise<void> {
  const pause = $<Adw.SwitchRow>('pause');
  // The shortcut is the person's to change (browser settings), so show the one they have,
  // formatted for this platform (mac: glyphs; see shortcut.ts).
  const shortcut = await toggleShortcut();
  pause.setAttribute('subtitle', shortcut ? t('pause_shortcut', shortcut) : t('pause_shortcut_unset'));
  onToggle(pause, async (paused) => {
    await saveSettings({ paused });
    await renderState();
  });
  $('banner').addEventListener('button-clicked', async () => {
    if (state !== 'paused') return;
    await saveSettings({ paused: false });
    await renderState();
  });
}

// --- sites ---------------------------------------------------------------------------------

const SITE_CHOICES: [value: string, label: MessageKey][] = [
  ['read', 'level_read'],
  ['write', 'site_level_write_ask'],
  ['write-silent', 'site_level_write_silent'],
  ['none', 'site_level_remove'],
];

async function renderSites(): Promise<void> {
  const { policy } = await loadSettings();
  const group = $<Adw.PreferencesGroup>('sites');
  for (const old of group.querySelectorAll('adw-combo-row')) old.remove();
  const entries = Object.entries(policy.origins).sort(([a], [b]) => a.localeCompare(b));
  markEmpty(group, entries.length === 0 ? t('sites_empty') : null);
  for (const [origin, rule] of entries) {
    const row = document.createElement('adw-combo-row') as Adw.ComboRow;
    row.setAttribute('title', origin);
    row.model = SITE_CHOICES.map(([value, label]) => ({ value, label: t(label) }));
    group.addRow(row);
    row.selectedValue =
      rule.level === 'write' ? (rule.confirmWrites === false ? 'write-silent' : 'write') : rule.level;
    // `notify::selected` fires for the person's pick only, never for the line above.
    row.addEventListener('notify::selected', async () => {
      const v = row.selectedValue;
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
  }
}

// --- features, screenshots included -------------------------------------------------------

/**
 * Screenshots are ONE decision for the person, though they take two things: the feature switch,
 * and the browser's access to all sites (Chromium's `captureVisibleTab` wants `<all_urls>`, and
 * Firefox does not even define it without). So the switch asks the browser in the same click,
 * and stays off when the browser says no.
 */
async function setScreenshots(row: Adw.SwitchRow, on: boolean): Promise<void> {
  // permissions.request must be the FIRST await after the click (Firefox's user gesture); the
  // row notifies synchronously inside its own click handler, so the gesture is still live.
  if (on) {
    const granted = await browser.permissions.request(ALL);
    if (!granted) {
      setQuietly(row, false);
      toast(t('screenshots_denied'));
      return;
    }
  } else {
    await browser.permissions.remove(ALL).catch(() => false);
  }
  await setFeature('screenshot', on);
  await renderShotsWarning();
}

/** Shown only when the two diverge: the feature is on, but the grant was taken back in the browser. */
async function renderShotsWarning(): Promise<void> {
  const { features } = await loadSettings();
  const granted = await browser.permissions.contains(ALL);
  $('shots-warning').hidden = !features.screenshot || granted;
}

function renderMethods(): void {
  // Developer detail: which protocol methods each switch covers. Method names are not translated.
  const expander = $<Adw.ExpanderRow>('methods');
  for (const feature of FEATURES) {
    const methods = (Object.keys(FEATURE_OF) as Method[]).filter((m) => FEATURE_OF[m] === feature);
    const row = document.createElement('adw-action-row');
    row.className = 'monospace-subtitle';
    row.setAttribute('title', featureLabel(feature));
    row.setAttribute('subtitle', methods.join(', '));
    expander.append(row);
  }
}

// --- tabs, windows and sessions: the person's own controls, no agent needed ------------------

function button(
  label: string,
  onClick: () => Promise<void>,
  look: { icon?: string; destructive?: boolean } = {},
): Gtk.Button {
  const b = document.createElement('gtk-button') as Gtk.Button;
  if (look.icon) {
    b.setAttribute('icon-name', look.icon);
    // An icon-only button takes its accessible name from the tooltip.
    b.setAttribute('tooltip-text', label);
    b.toggleAttribute('circular', true);
  } else b.setAttribute('label', label);
  b.setAttribute('slot', 'suffix');
  b.toggleAttribute('flat', true);
  if (look.destructive) b.toggleAttribute('destructive', true);
  b.addEventListener('click', () => void onClick());
  return b;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(uiLanguage(), { dateStyle: 'medium', timeStyle: 'short' });

const counts = (windows: number, tabs: number) => `${plural('windows', windows)}, ${plural('tabs', tabs)}`;

/** The tab list as the row's hover text. */
const hoverList = (row: HTMLElement, lines: string[]) => hoverText(row, lines.join('\n'));

const sessionName = (s: SavedSession) => (s.kind === 'auto' ? when(s.savedAt) : s.name);

function sessionRow(session: SavedSession): HTMLElement {
  const tabs = session.windows.reduce((n, w) => n + w.tabs.length, 0);
  const row = document.createElement('adw-action-row');
  row.setAttribute('title', sessionName(session));
  row.setAttribute(
    'subtitle',
    [
      counts(session.windows.length, tabs),
      ...(session.kind === 'auto' ? [] : [when(session.savedAt)]),
      ...(session.kind === 'agent' ? [t('session_by_agent')] : []),
    ].join(' · '),
  );
  row.append(
    button(t('action_restore'), async () => {
      const { policy } = await loadSettings();
      await restoreSession(session, policy, 'new-windows');
    }),
    // Deleting is undoable from the toast, the GNOME way, instead of asking first.
    button(
      t('action_delete'),
      async () => {
        await updateSessions((all) => all.filter((s) => s.name !== session.name));
        await renderSessions();
        toast(t('session_deleted', sessionName(session)), {
          buttonLabel: t('action_undo'),
          onAction: () =>
            void updateSessions((all) => upsertSession(all, session)).then(() => renderSessions()),
        });
      },
      { icon: 'user-trash-symbolic', destructive: true },
    ),
  );
  return row;
}

async function renderSessions(): Promise<void> {
  const sessions = (await loadSessions()).sort((a, b) => b.savedAt - a.savedAt);
  const named = sessions.filter((s) => s.kind !== 'auto');
  const autos = sessions.filter((s) => s.kind === 'auto');
  const group = $<Adw.PreferencesGroup>('sessions');
  const autoRow = $<Adw.ExpanderRow>('autos');
  for (const old of group.querySelectorAll('adw-action-row')) old.remove();
  for (const old of autoRow.querySelectorAll('adw-action-row')) old.remove();
  autoRow.setAttribute('subtitle', autos.length === 0 ? t('autos_empty') : String(autos.length));
  for (const s of named) {
    const row = sessionRow(s);
    group.addRow(row);
    hoverList(row, tabLines(s));
  }
  for (const s of autos) {
    const row = sessionRow(s);
    autoRow.append(row);
    hoverList(row, tabLines(s));
  }
}

const tabLines = (s: SavedSession) => s.windows.flatMap((w) => w.tabs.map((tab) => tab.title || tab.url));

async function renderClosed(): Promise<void> {
  const group = $<Adw.PreferencesGroup>('closed');
  for (const old of group.querySelectorAll('adw-action-row')) old.remove();
  const api = sessionsApi();
  const items = api ? await api.getRecentlyClosed({ maxResults: 25 }).catch(() => []) : [];
  const windows = items.filter((i) => i.window && i.window.type !== 'popup' && !i.window.incognito);
  markEmpty(group, windows.length === 0 ? t('closed_empty') : null);
  for (const item of windows) {
    const tabs = item.window!.tabs ?? [];
    const hosts = [...new Set(tabs.map((tab) => hostOf(tab.url)).filter(Boolean))];
    const row = document.createElement('adw-action-row');
    row.setAttribute('title', plural('tabs', tabs.length));
    row.setAttribute('subtitle', hosts.slice(0, 4).join(', ') + (hosts.length > 4 ? ', …' : ''));
    row.append(
      button(t('action_restore'), async () => {
        await api!.restore(item.window!.sessionId);
        await renderClosed();
      }),
    );
    group.addRow(row);
    hoverList(
      row,
      tabs.map((tab) => tab.title || tab.url || ''),
    );
  }
}

const NAME_MESSAGES: Record<SessionNameIssue, () => string> = {
  type: () => t('session_name_empty'),
  empty: () => t('session_name_empty'),
  whitespace: () => t('session_name_whitespace'),
  length: () => t('session_name_too_long', MAX_NAME),
  control: () => t('session_name_control'),
  reserved: () => t('session_name_reserved', AUTOSAVE_PREFIX),
};

async function setupTabs(): Promise<void> {
  const settings = await loadSettings();
  const confirmClose = $<Adw.SwitchRow>('confirm-close');
  const autosave = $<Adw.SwitchRow>('autosave');
  setQuietly(confirmClose, settings.confirmClose);
  setQuietly(autosave, settings.autosave);
  onToggle(confirmClose, (on) => void saveSettings({ confirmClose: on }));
  onToggle(autosave, (on) => void saveSettings({ autosave: on }));

  const nameRow = $<Adw.EntryRow>('session-name');
  const save = async () => {
    const name = nameRow.text.trim();
    const issue = sessionNameIssue(name);
    if (issue) return toast(NAME_MESSAGES[issue]());
    const { session } = await capture(name, 'saved');
    if (session.windows.length === 0) return toast(t('session_nothing_open'));
    await updateSessions((all) => upsertSession(all, session));
    nameRow.text = '';
    toast(t('session_saved', name));
    await renderSessions();
  };
  $('session-save').addEventListener('click', () => void save());
  nameRow.addEventListener('entry-activated', () => void save());

  await renderSessions();
  await renderClosed();
}

// --- connection ------------------------------------------------------------------------------

const RESULT: Partial<Record<UiState, MessageKey>> = {
  ready: 'pairing_connected',
  working: 'pairing_connected',
  offline: 'pairing_saved_offline',
  unauthorized: 'banner_unauthorized',
  protocol: 'banner_protocol',
};

async function connect(): Promise<void> {
  const token = $<Adw.PasswordEntryRow>('token').text.trim();
  if (!token) return toast(t('pairing_need_token'));
  const save = $<Gtk.Button>('save');
  save.toggleAttribute('disabled', true);
  await saveSettings({
    token,
    port: $<Adw.SpinRow>('port').value,
    portCount: $<Adw.SpinRow>('port-count').value,
  });
  await browser.runtime.sendMessage({ type: 'reconnect' });
  // The outcome is a toast: the person just clicked here, and a line beside the button would stay.
  let current = await status();
  for (let i = 0; i < 10 && current?.state === 'offline'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    current = await status();
  }
  await renderState();
  save.toggleAttribute('disabled', false);
  const key = RESULT[stateOf(current, false)];
  if (key) toast(t(key));
}

function renderRange(): void {
  const base = $<Adw.SpinRow>('port').value;
  const count = $<Adw.SpinRow>('port-count').value;
  $('ports').setAttribute('subtitle', count === 1 ? String(base) : t('ports_range', base, base + count - 1));
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  $<Adw.PasswordEntryRow>('token').text = settings.token;
  $<Adw.SpinRow>('port').value = settings.port;
  $<Adw.SpinRow>('port-count').value = settings.portCount;
  renderRange();
  for (const id of ['port', 'port-count']) $(id).addEventListener('notify::value', renderRange);
  $('save').addEventListener('click', () => void connect());

  switchRowIcon($('pause'), 'media-playback-pause-symbolic');
  switchRowIcon($('confirm-close'), 'window-close-symbolic');
  switchRowIcon($('autosave'), 'document-open-recent-symbolic');
  $('pairing').append(infoButton('pairing_info'));
  $('features').append(infoButton('features_info'));
  $('shots-grant').addEventListener('click', async () => {
    // First await after the click, for the same user-gesture reason as the switch.
    if (await browser.permissions.request(ALL)) await renderShotsWarning();
    else toast(t('screenshots_denied'));
  });
  renderMethods();

  const features = $('features');
  const onChange = { screenshot: (row: Adw.SwitchRow, on: boolean) => void setScreenshots(row, on) };
  await Promise.all([
    setupPause(),
    renderState(),
    renderSites(),
    setupTabs(),
    renderFeatures(features, onChange),
    renderShotsWarning(),
  ]);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.paused) void renderState();
    if (changes.features || changes.grants) {
      void renderFeatures(features, onChange);
      void renderShotsWarning();
    }
  });
  setInterval(() => void renderState(), 2000);
  // The popup's "Show all" opens this page at its activity.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

void main();
