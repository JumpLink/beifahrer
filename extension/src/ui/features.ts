/**
 * The person's controls shared by popup and options: the feature switches, the pause switch, and
 * the activity list. Resuming happens here (and on the keyboard shortcut) and nowhere else.
 */

import { browser } from '@wxt-dev/browser';
import { FEATURES, FEATURE_INFO, type ActivityEntry, type Feature } from '@beifahrer/core';
import { loadSettings, saveSettings } from '../settings.ts';

/** One checkbox per feature. `compact` leaves the detail line out (popup). */
export async function renderFeatures(container: HTMLElement, compact: boolean): Promise<void> {
  const { features } = await loadSettings();
  container.replaceChildren();
  for (const feature of FEATURES) {
    const row = document.createElement('label');
    row.className = 'row feature';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.feature = feature;
    box.checked = features[feature];
    box.addEventListener('change', () => void setFeature(feature, box.checked));
    const text = document.createElement('span');
    text.textContent = FEATURE_INFO[feature].label;
    row.append(box, text);
    if (!compact) {
      const detail = document.createElement('span');
      detail.className = 'muted detail';
      detail.textContent = FEATURE_INFO[feature].detail;
      text.append(document.createElement('br'), detail);
    }
    container.append(row);
  }
}

async function setFeature(feature: Feature, on: boolean): Promise<void> {
  // All switches are written together, so the legacy `grants` fallback stops applying at once.
  const { features } = await loadSettings();
  await saveSettings({ features: { ...features, [feature]: on } });
}

/** The pause switch: a button with role="switch", pressed = running. */
export async function renderPause(button: HTMLButtonElement, line: HTMLElement): Promise<void> {
  const { paused } = await loadSettings();
  button.setAttribute('aria-checked', String(!paused));
  button.textContent = paused ? 'Paused — resume' : 'On — pause';
  button.classList.toggle('paused', paused);
  line.textContent = paused
    ? 'Paused. The agent gets nothing from this browser, not even the list of tabs.'
    : 'The agent may use this browser within the limits below.';
}

export function wirePause(button: HTMLButtonElement, line: HTMLElement): void {
  button.addEventListener('click', async () => {
    const { paused } = await loadSettings();
    await saveSettings({ paused: !paused });
    await renderPause(button, line);
  });
}

export interface ActivitySnapshot {
  log: ActivityEntry[];
  inFlight: number;
  lastActivityAt: number;
}

export async function loadActivity(): Promise<ActivitySnapshot> {
  return (await browser.runtime.sendMessage({ type: 'activity' })) as ActivitySnapshot;
}

const REASONS: Record<string, string> = {
  paused: 'refused: paused',
  feature_disabled: 'refused: feature off',
  forbidden: 'refused: site level',
  denied: 'you declined',
};

export function renderActivity(list: HTMLElement, empty: HTMLElement, log: ActivityEntry[]): void {
  list.replaceChildren();
  empty.hidden = log.length > 0;
  for (const entry of log) {
    const item = document.createElement('li');
    item.className = entry.outcome;
    const time = document.createElement('time');
    time.textContent = new Date(entry.at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const what = document.createElement('span');
    what.textContent = ` ${entry.words}${entry.host ? ` · ${entry.host}` : ''}`;
    item.append(time, what);
    if (entry.session) {
      const who = document.createElement('span');
      who.className = 'muted';
      who.textContent = ` — ${entry.session}`;
      item.append(who);
    }
    if (entry.preview) {
      const preview = document.createElement('span');
      preview.className = 'muted';
      preview.textContent = ` “${entry.preview}”`;
      item.append(preview);
    }
    if (entry.outcome !== 'ok') {
      const reason = document.createElement('span');
      reason.className = 'warn';
      reason.textContent = ` — ${REASONS[entry.reason ?? ''] ?? `failed: ${entry.reason ?? '?'}`}`;
      item.append(reason);
    }
    list.append(item);
  }
}
