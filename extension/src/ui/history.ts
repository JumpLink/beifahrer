/**
 * The history section of the options page (ADR 0029): the switch, the stored count while it is off,
 * the list grouped by day, and the one-click clear. Reads straight from the extension's own
 * storage; nothing here goes through the background or the bridge.
 */

import type { Adw } from '@gjsify/adwaita-web';
import type { HistoryEntry } from '@beifahrer/core';
import { methodWords, plural, t, uiLanguage } from '../i18n.ts';
import {
  clearHistory,
  historyArea,
  historyEnabled,
  readHistory,
  setHistoryEnabled,
  type LocalArea,
} from '../history.ts';
import { REASONS, onToggle, setQuietly } from './features.ts';
import { methodIcon } from './icon-names.ts';
import { showToast } from './toast.ts';

const SHOWN = 100;

const day = (at: number) =>
  new Date(at).toLocaleDateString(uiLanguage(), { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (at: number) =>
  new Date(at).toLocaleTimeString(uiLanguage(), { hour: '2-digit', minute: '2-digit' });

/** Text as well as colour: "Done", "Refused · Paused", "Failed". */
export function outcomeWords(entry: HistoryEntry): string {
  const word = t(`history_outcome_${entry.outcome}`);
  if (entry.outcome === 'ok') return word;
  const known = entry.reason ? REASONS[entry.reason] : undefined;
  return known ? `${word} · ${t(known)}` : word;
}

/** Newest first, as given, split at each calendar day. */
export function groupByDay(entries: readonly HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = day(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export function setupHistory(): void {
  const area: LocalArea = historyArea();
  const sw = document.getElementById('history-on') as Adw.SwitchRow;
  const status = document.getElementById('history-status') as HTMLElement;
  const list = document.getElementById('history-list') as HTMLElement;
  const clear = document.getElementById('history-clear') as HTMLElement;
  let showAll = false;

  async function render(): Promise<void> {
    const [on, entries] = await Promise.all([historyEnabled(area), readHistory(area, Date.now())]);
    setQuietly(sw, on);
    status.hidden = on || entries.length === 0;
    status.textContent = on ? '' : plural('history_stored', entries.length);
    clear.hidden = entries.length === 0;
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dimmed history-empty';
      empty.textContent = t('history_empty');
      list.append(empty);
      return;
    }
    let left = showAll ? entries.length : SHOWN;
    for (const group of groupByDay(entries)) {
      if (left <= 0) break;
      const card = document.createElement('adw-preferences-group');
      card.setAttribute('title', group.label);
      list.append(card);
      for (const entry of group.entries.slice(0, left)) {
        const row = document.createElement('adw-action-row');
        row.className = `history-${entry.outcome}`;
        row.setAttribute('title', methodWords(entry.method));
        row.setAttribute('subtitle', `${entry.host ?? t('history_no_host')} · ${clock(entry.at)}`);
        const icon = document.createElement('gtk-image');
        icon.setAttribute('icon-name', methodIcon(entry.method));
        icon.slot = 'prefix';
        const outcome = document.createElement('span');
        outcome.slot = 'suffix';
        outcome.className = `caption history-outcome history-outcome-${entry.outcome}`;
        outcome.textContent = outcomeWords(entry);
        row.append(icon, outcome);
        (card as Adw.PreferencesGroup).addRow(row);
      }
      left -= group.entries.length;
    }
    if (entries.length > SHOWN && !showAll) {
      const more = document.createElement('adw-button-row');
      more.setAttribute('title', t('activity_show_all'));
      more.addEventListener('activated', () => {
        showAll = true;
        void render();
      });
      const host = document.createElement('adw-preferences-group');
      list.append(host);
      (host as Adw.PreferencesGroup).addRow(more);
    }
  }

  onToggle(sw, async (on) => {
    await setHistoryEnabled(area, on);
    await render();
  });
  clear.addEventListener('activated', async () => {
    await clearHistory(area);
    showAll = false;
    await render();
    showToast(t('history_cleared'), { timeout: 4 });
  });
  void render();
  // The agent keeps working while this page is open; a slow poll of our own storage is enough.
  setInterval(() => void render().catch(() => undefined), 5000);
}
