/**
 * The person's controls shared by popup and options: the feature switches, the pause switch, and
 * the activity list. Resuming happens here (and on the keyboard shortcut) and nowhere else.
 *
 * The rows are Adwaita elements (`ui.js` defines them before any page script runs). An
 * `<adw-switch-row>` notifies `notify::active` for a PROGRAMMATIC change too, as libadwaita does,
 * so every render that follows storage marks its own writes (`quietly`): otherwise redrawing a
 * switch would write the value straight back, and a render racing a click could undo it.
 */

import { browser } from '@wxt-dev/browser';
import { FEATURES, type ActivityEntry, type Feature } from '@beifahrer/core';
import type { Adw } from '@gjsify/adwaita-web';
import { featureDetail, featureLabel, methodWords, t, uiLanguage } from '../i18n.ts';
import { loadSettings, saveSettings } from '../settings.ts';

const settling = new WeakSet<Element>();

/** Set a switch row without treating the change as the person's. */
export function setQuietly(row: Adw.SwitchRow, active: boolean): void {
  if (row.active === active) return;
  settling.add(row);
  row.active = active;
  settling.delete(row);
}

/** Listen for the PERSON flipping a switch row; renders through `setQuietly` are ignored. */
export function onToggle(row: Adw.SwitchRow, handler: (active: boolean) => void): void {
  row.addEventListener('notify::active', (event) => {
    // The event bubbles: a switch row nested in another row must not flip its ancestor.
    if (event.target === row && !settling.has(row)) handler(row.active);
  });
}

export function switchRow(title: string, subtitle?: string): Adw.SwitchRow {
  const row = document.createElement('adw-switch-row') as Adw.SwitchRow;
  row.setAttribute('title', title);
  if (subtitle) row.setAttribute('subtitle', subtitle);
  return row;
}

const featureRows = new WeakMap<HTMLElement, Map<Feature, Adw.SwitchRow>>();

/**
 * One switch row per feature, in `container` (an expander row in the popup, a preferences group
 * in the options). Built once, then only updated: an upgraded Adwaita container owns its inner
 * boxes, and emptying it would take them with the rows. `compact` leaves the detail line out.
 */
export async function renderFeatures(container: HTMLElement, compact: boolean): Promise<void> {
  const { features } = await loadSettings();
  let rows = featureRows.get(container);
  if (!rows) {
    rows = new Map();
    for (const feature of FEATURES) {
      const row = switchRow(featureLabel(feature), compact ? undefined : featureDetail(feature));
      row.dataset.feature = feature;
      onToggle(row, (on) => void setFeature(feature, on));
      rows.set(feature, row);
      container.append(row);
    }
    featureRows.set(container, rows);
  }
  for (const [feature, row] of rows) setQuietly(row, features[feature]);
  if (compact) {
    const on = FEATURES.filter((f) => features[f]).length;
    container.setAttribute('subtitle', t('features_count', on, FEATURES.length));
  }
}

async function setFeature(feature: Feature, on: boolean): Promise<void> {
  // All switches are written together, so the legacy `grants` fallback stops applying at once.
  const { features } = await loadSettings();
  await saveSettings({ features: { ...features, [feature]: on } });
}

/** The pause switch: on = the agent may use the browser, off = paused. */
export async function renderPause(row: Adw.SwitchRow, banner?: Adw.Banner): Promise<void> {
  const { paused } = await loadSettings();
  setQuietly(row, !paused);
  row.setAttribute('subtitle', t(paused ? 'pause_paused' : 'pause_running'));
  if (banner) {
    banner.setAttribute('title', t('pause_banner'));
    banner.toggleAttribute('revealed', paused);
  }
}

export function wirePause(row: Adw.SwitchRow, banner?: Adw.Banner): void {
  onToggle(row, async (running) => {
    await saveSettings({ paused: !running });
    await renderPause(row, banner);
  });
  // The banner's button is the same resume, one click from where the eye lands first.
  banner?.addEventListener('button-clicked', async () => {
    await saveSettings({ paused: false });
    await renderPause(row, banner);
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

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'paused':
      return t('reason_paused');
    case 'feature_disabled':
      return t('reason_feature_disabled');
    case 'forbidden':
      return t('reason_forbidden');
    case 'denied':
      return t('reason_denied');
    default:
      return t('reason_failed', reason ?? '?');
  }
}

/**
 * A group with nothing in it says why in its description, and its empty card is not drawn —
 * libadwaita's own pattern for an empty preferences group.
 */
export function markEmpty(group: Adw.PreferencesGroup, emptyText: string | null): void {
  group.classList.toggle('empty', emptyText !== null);
  if (emptyText !== null) group.setAttribute('description', emptyText);
  else group.removeAttribute('description');
}

let shownLog = '';

/** One action row per request, newest first. Redrawn only when the log changed. */
export function renderActivity(group: Adw.PreferencesGroup, log: ActivityEntry[]): void {
  const key = JSON.stringify(log);
  if (key === shownLog) return;
  shownLog = key;
  for (const old of group.querySelectorAll('adw-action-row')) group.removeRow(old);
  markEmpty(group, log.length === 0 ? t('activity_empty') : null);
  for (const entry of log) {
    const row = document.createElement('adw-action-row');
    row.className = `activity-${entry.outcome}`;
    row.setAttribute('title', `${methodWords(entry.method)}${entry.host ? ` · ${entry.host}` : ''}`);
    const time = new Date(entry.at).toLocaleTimeString(uiLanguage(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    // The session label comes from the agent's side: an attribute value, never markup.
    row.setAttribute(
      'subtitle',
      [time, entry.session, entry.preview ? `“${entry.preview}”` : undefined].filter(Boolean).join(' · '),
    );
    if (entry.outcome !== 'ok') {
      const reason = document.createElement('span');
      reason.slot = 'suffix';
      reason.className = 'caption activity-reason';
      reason.textContent = reasonText(entry.reason);
      row.append(reason);
    }
    group.addRow(row);
  }
}
