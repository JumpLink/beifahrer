import { browser } from '@wxt-dev/browser';
import {
  hostOf,
  sessionNameError,
  upsertSession,
  withRule,
  type Level,
  type SavedSession,
} from '@beifahrer/core';
import {
  capture,
  loadSessions,
  restoreSession,
  sessionsApi,
  updateSessions,
} from '../../src/sessions-store.ts';
import { loadSettings, originPattern, saveSettings } from '../../src/settings.ts';
import { renderFeatures, renderPause, wirePause } from '../../src/ui/features.ts';
import { describeStatus } from '../../src/ui/status.ts';
import type { Status } from '../../src/bridge-client.ts';

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

// --- tabs, windows and sessions: the person's own controls, no agent needed ------------------

function button(label: string, onClick: () => Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn mini';
  b.textContent = label;
  b.addEventListener('click', () => void onClick());
  return b;
}

const when = (ms: number) => new Date(ms).toLocaleString();

function sessionRow(table: HTMLTableElement, session: SavedSession): void {
  const tabs = session.windows.reduce((n, w) => n + w.tabs.length, 0);
  const row = table.insertRow();
  row.insertCell().textContent = session.kind === 'auto' ? when(session.savedAt) : session.name;
  row.insertCell().textContent =
    `${session.windows.length} window${session.windows.length === 1 ? '' : 's'}, ${tabs} tab${tabs === 1 ? '' : 's'}` +
    (session.kind === 'auto' ? '' : ` · ${when(session.savedAt)}`) +
    (session.kind === 'agent' ? ' · built by the agent' : '');
  row.title = session.windows.flatMap((w) => w.tabs.map((t) => t.title || t.url)).join('\n');
  const actions = row.insertCell();
  actions.append(
    button('Restore', async () => {
      const { policy } = await loadSettings();
      await restoreSession(session, policy, 'new-windows');
    }),
    ' ',
    button('Delete', async () => {
      await updateSessions((all) => all.filter((s) => s.name !== session.name));
      await renderSessions();
    }),
  );
}

async function renderSessions(): Promise<void> {
  const sessions = (await loadSessions()).sort((a, b) => b.savedAt - a.savedAt);
  const named = sessions.filter((s) => s.kind !== 'auto');
  const autos = sessions.filter((s) => s.kind === 'auto');
  const table = $<HTMLTableElement>('sessions');
  const autoTable = $<HTMLTableElement>('autos');
  table.replaceChildren();
  autoTable.replaceChildren();
  $('sessions-empty').hidden = named.length > 0;
  $('autos-empty').hidden = autos.length > 0;
  for (const s of named) sessionRow(table, s);
  for (const s of autos) sessionRow(autoTable, s);
}

async function renderClosed(): Promise<void> {
  const table = $<HTMLTableElement>('closed');
  table.replaceChildren();
  const api = sessionsApi();
  const items = api ? await api.getRecentlyClosed({ maxResults: 25 }).catch(() => []) : [];
  const windows = items.filter((i) => i.window && i.window.type !== 'popup' && !i.window.incognito);
  $('closed-empty').hidden = windows.length > 0;
  for (const item of windows) {
    const tabs = item.window!.tabs ?? [];
    const row = table.insertRow();
    const hosts = [...new Set(tabs.map((t) => hostOf(t.url)).filter(Boolean))];
    row.insertCell().textContent =
      `${tabs.length} tab${tabs.length === 1 ? '' : 's'}: ${hosts.slice(0, 4).join(', ')}` +
      (hosts.length > 4 ? ', …' : '');
    row.title = tabs.map((t) => t.title || t.url).join('\n');
    row.insertCell().append(
      button('Restore', async () => {
        await api!.restore(item.window!.sessionId);
        await renderClosed();
      }),
    );
  }
}

async function setupTabs(): Promise<void> {
  const settings = await loadSettings();
  const confirmClose = $('confirm-close') as HTMLInputElement;
  const autosave = $('autosave') as HTMLInputElement;
  confirmClose.checked = settings.confirmClose;
  autosave.checked = settings.autosave;
  confirmClose.addEventListener('change', () => void saveSettings({ confirmClose: confirmClose.checked }));
  autosave.addEventListener('change', () => void saveSettings({ autosave: autosave.checked }));

  $('session-save').addEventListener('click', async () => {
    const note = $('session-note');
    const name = ($('session-name') as HTMLInputElement).value.trim();
    const error = sessionNameError(name);
    if (error) {
      note.textContent = error;
      note.className = 'warn';
      return;
    }
    const { session } = await capture(name, 'saved');
    if (session.windows.length === 0) {
      note.textContent = 'No web page is open — nothing to save.';
      note.className = 'warn';
      return;
    }
    await updateSessions((all) => upsertSession(all, session));
    note.textContent = `✓ Saved "${name}"`;
    note.className = 'ok';
    await renderSessions();
  });

  await renderSessions();
  await renderClosed();
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  ($('token') as HTMLInputElement).value = settings.token;
  ($('port') as HTMLInputElement).value = String(settings.port);
  ($('port-count') as HTMLInputElement).value = String(settings.portCount);
  ($('shots') as HTMLInputElement).checked = await browser.permissions.contains(ALL);

  $('save').addEventListener('click', async () => {
    const note = $('saved');
    const token = ($('token') as HTMLInputElement).value.trim();
    if (!token) {
      note.textContent = 'Paste the token first.';
      note.className = 'warn';
      return;
    }
    await saveSettings({
      token,
      port: Number(($('port') as HTMLInputElement).value),
      portCount: Number(($('port-count') as HTMLInputElement).value),
    });
    note.textContent = 'Saved — connecting…';
    note.className = 'muted';
    await browser.runtime.sendMessage({ type: 'reconnect' });
    // Say how it ended, right next to the button: the person just clicked here, not at the
    // status line at the top of the page.
    for (let i = 0; i < 10; i++) {
      const status = (await browser.runtime.sendMessage({ type: 'status' })) as Status;
      await renderStatus();
      if (status.state === 'connected') {
        note.textContent = '✓ Connected';
        note.className = 'ok';
        return;
      }
      if (status.state === 'unauthorized' || status.state === 'protocol') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const status = (await browser.runtime.sendMessage({ type: 'status' })) as Status;
    note.textContent =
      status.state === 'offline'
        ? '✓ Saved. No bridge is running yet — it starts with your agent, and the extension connects then.'
        : describeStatus(status);
    note.className = status.state === 'offline' ? 'ok' : 'warn';
  });

  $('shots').addEventListener('change', async () => {
    const box = $('shots') as HTMLInputElement;
    // First await in the handler, for the same user-gesture reason as in the popup.
    const ok = box.checked ? await browser.permissions.request(ALL) : await browser.permissions.remove(ALL);
    box.checked = box.checked ? ok : !ok;
  });

  await renderStatus();
  await renderSites();
  await setupTabs();
  const pause = $<HTMLButtonElement>('pause');
  wirePause(pause, $('state'));
  await renderPause(pause, $('state'));
  await renderFeatures($('features'), false);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.paused) void renderPause(pause, $('state'));
    if (changes.features || changes.grants) void renderFeatures($('features'), false);
  });
  setInterval(() => void renderStatus(), 3000);
}

void main();
