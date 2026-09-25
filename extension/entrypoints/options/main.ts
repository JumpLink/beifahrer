import { browser } from '@wxt-dev/browser';
import {
  AUTOSAVE_PREFIX,
  MAX_NAME,
  hostOf,
  sessionNameIssue,
  upsertSession,
  withRule,
  type Level,
  type SavedSession,
  type SessionNameIssue,
} from '@beifahrer/core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../../src/bridge-client.ts';
import { plural, t, uiLanguage, type MessageKey } from '../../src/i18n.ts';
import {
  capture,
  loadSessions,
  restoreSession,
  sessionsApi,
  updateSessions,
} from '../../src/sessions-store.ts';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import {
  markEmpty,
  onToggle,
  renderFeatures,
  renderPause,
  setQuietly,
  wirePause,
} from '../../src/ui/features.ts';
import { describeStatus } from '../../src/ui/status.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ALL = { origins: ['<all_urls>'] };
const toast = (text: string) => $<Adw.ToastOverlay>('toasts').addToast(text, { timeout: 4 });

/** Inline feedback next to what the person just clicked, coloured by Adwaita's own classes. */
function note(el: HTMLElement, text: string, tone: 'success' | 'warning' | 'error' | 'dimmed'): void {
  el.textContent = text;
  el.className = `note ${tone}`;
}

async function renderStatus(): Promise<void> {
  $('status').textContent = describeStatus(await browser.runtime.sendMessage({ type: 'status' }));
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

// --- tabs, windows and sessions: the person's own controls, no agent needed ------------------

function button(label: string, onClick: () => Promise<void>, style?: 'destructive'): Gtk.Button {
  const b = document.createElement('gtk-button') as Gtk.Button;
  b.setAttribute('label', label);
  b.setAttribute('slot', 'suffix');
  b.toggleAttribute('flat', true);
  if (style) b.toggleAttribute(style, true);
  b.addEventListener('click', () => void onClick());
  return b;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(uiLanguage(), { dateStyle: 'medium', timeStyle: 'short' });

const counts = (windows: number, tabs: number) => `${plural('windows', windows)}, ${plural('tabs', tabs)}`;

/** The tab list as a hover text on the row's labels (the row's own `title` is its heading). */
function hoverList(row: HTMLElement, lines: string[]): void {
  row.querySelector('.adw-row-text')?.setAttribute('title', lines.join('\n'));
}

function sessionRow(session: SavedSession): HTMLElement {
  const tabs = session.windows.reduce((n, w) => n + w.tabs.length, 0);
  const row = document.createElement('adw-action-row');
  row.setAttribute('title', session.kind === 'auto' ? when(session.savedAt) : session.name);
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
    button(
      t('action_delete'),
      async () => {
        await updateSessions((all) => all.filter((s) => s.name !== session.name));
        toast(t('session_deleted', session.kind === 'auto' ? when(session.savedAt) : session.name));
        await renderSessions();
      },
      'destructive',
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
  markEmpty(group, named.length === 0 ? t('sessions_empty') : null);
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
    const out = $('session-note');
    const name = nameRow.text.trim();
    const issue = sessionNameIssue(name);
    if (issue) return note(out, NAME_MESSAGES[issue](), 'error');
    const { session } = await capture(name, 'saved');
    if (session.windows.length === 0) return note(out, t('session_nothing_open'), 'warning');
    await updateSessions((all) => upsertSession(all, session));
    note(out, '', 'dimmed');
    nameRow.text = '';
    toast(t('session_saved', name));
    await renderSessions();
  };
  $('session-save').addEventListener('click', () => void save());
  nameRow.addEventListener('entry-activated', () => void save());

  await renderSessions();
  await renderClosed();
}

// --- pairing -------------------------------------------------------------------------------

async function connect(): Promise<void> {
  const out = $('saved');
  const token = $<Adw.PasswordEntryRow>('token').text.trim();
  if (!token) return note(out, t('pairing_need_token'), 'warning');
  await saveSettings({
    token,
    port: $<Adw.SpinRow>('port').value,
    portCount: $<Adw.SpinRow>('port-count').value,
  });
  note(out, t('pairing_connecting'), 'dimmed');
  await browser.runtime.sendMessage({ type: 'reconnect' });
  // Say how it ended, right next to the button: the person just clicked here, not at the
  // status line at the top of the page.
  for (let i = 0; i < 10; i++) {
    const status = (await browser.runtime.sendMessage({ type: 'status' })) as Status;
    await renderStatus();
    if (status.state === 'connected') return note(out, t('pairing_connected'), 'success');
    if (status.state === 'unauthorized' || status.state === 'protocol') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const status = (await browser.runtime.sendMessage({ type: 'status' })) as Status;
  if (status.state === 'offline') note(out, t('pairing_saved_offline'), 'success');
  else note(out, describeStatus(status), 'warning');
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  $<Adw.PasswordEntryRow>('token').text = settings.token;
  $<Adw.SpinRow>('port').value = settings.port;
  $<Adw.SpinRow>('port-count').value = settings.portCount;
  $('save').addEventListener('click', () => void connect());

  const shots = $<Adw.SwitchRow>('shots');
  setQuietly(shots, await browser.permissions.contains(ALL));
  onToggle(shots, async (on) => {
    // First await after the click, for the same user-gesture reason as in the popup: the row
    // notifies synchronously inside its own click handler.
    const ok = on ? await browser.permissions.request(ALL) : await browser.permissions.remove(ALL);
    setQuietly(shots, on ? ok : !ok);
  });

  const pause = $<Adw.SwitchRow>('pause');
  const banner = $<Adw.Banner>('paused');
  wirePause(pause, banner);
  const features = $('features');
  await Promise.all([
    renderStatus(),
    renderSites(),
    setupTabs(),
    renderPause(pause, banner),
    renderFeatures(features, false),
  ]);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.paused) void renderPause(pause, banner);
    if (changes.features || changes.grants) void renderFeatures(features, false);
  });
  setInterval(() => void renderStatus(), 3000);
}

void main();
