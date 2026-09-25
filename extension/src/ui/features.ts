/**
 * The person's controls shared by popup and options: switch handling, the feature switches and
 * the activity list. Resuming happens in popup, options and on the keyboard shortcut, nowhere else.
 *
 * The rows are Adwaita elements (`ui.js` defines them before any page script runs). An
 * `<adw-switch-row>` notifies `notify::active` for a PROGRAMMATIC change too, as libadwaita does,
 * so every render that follows storage marks its own writes (`quietly`): otherwise redrawing a
 * switch would write the value straight back, and a render racing a click could undo it.
 */

import { browser } from '@wxt-dev/browser';
import { FEATURES, type ActivityEntry, type Feature } from '@beifahrer/core';
import type { Adw } from '@gjsify/adwaita-web';
import { featureLabel, methodWords, t, uiLanguage, type MessageKey } from '../i18n.ts';
import { loadSettings, saveSettings } from '../settings.ts';
import { FEATURE_ICON, methodIcon } from './icon-names.ts';

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

/**
 * A row's hover text. The row's own `title` attribute is its heading, so the text goes on its
 * label column, which an action row names `.adw-action-row-text` and a switch row
 * `.adw-row-text`. Looking for only the second left every action row without one.
 */
export function hoverText(row: Element, text: string): void {
  row.querySelector('.adw-action-row-text, .adw-row-text')?.setAttribute('title', text);
}

/** A symbolic icon for a row's prefix slot. */
export function prefixIcon(name: string): HTMLElement {
  const icon = document.createElement('gtk-image');
  icon.setAttribute('icon-name', name);
  icon.slot = 'prefix';
  return icon;
}

/**
 * gjsify gap (unfixed, @gjsify/adwaita-web 0.52.0): <adw-switch-row> replaces its children when
 * it upgrades and has no prefix slot, though libadwaita's AdwSwitchRow is an AdwActionRow with
 * `add_prefix`. So the icon is put in front of the label column once the row is upgraded
 * (connected), and `.switch-row-prefix` in style.css spaces it like a prefix.
 */
export function switchRowIcon(row: HTMLElement, name: string): void {
  if (row.querySelector(':scope > .switch-row-prefix')) return;
  const icon = document.createElement('gtk-image');
  icon.setAttribute('icon-name', name);
  icon.className = 'switch-row-prefix';
  row.prepend(icon);
}

const featureRows = new WeakMap<HTMLElement, Map<Feature, Adw.SwitchRow>>();

/**
 * One switch row per feature, with its icon, in a preferences group. Built once, then only
 * updated: an upgraded Adwaita container owns its inner boxes, and emptying it would take them
 * with the rows. `onChange` replaces the plain write for a feature that needs more than one
 * (screenshots also ask the browser for access, in the same click).
 */
export async function renderFeatures(
  container: HTMLElement,
  onChange: Partial<Record<Feature, (row: Adw.SwitchRow, on: boolean) => void>> = {},
): Promise<void> {
  const { features } = await loadSettings();
  let rows = featureRows.get(container);
  if (!rows) {
    rows = new Map();
    for (const feature of FEATURES) {
      const row = document.createElement('adw-switch-row') as Adw.SwitchRow;
      row.setAttribute('title', featureLabel(feature));
      row.dataset.feature = feature;
      const custom = onChange[feature];
      onToggle(row, (on) => (custom ? custom(row, on) : void setFeature(feature, on)));
      rows.set(feature, row);
      container.append(row);
      switchRowIcon(row, FEATURE_ICON[feature]);
    }
    featureRows.set(container, rows);
  }
  for (const [feature, row] of rows) setQuietly(row, features[feature]);
}

export async function setFeature(feature: Feature, on: boolean): Promise<void> {
  // All switches are written together, so the legacy `grants` fallback stops applying at once.
  const { features } = await loadSettings();
  await saveSettings({ features: { ...features, [feature]: on } });
}

export interface ActivitySnapshot {
  log: ActivityEntry[];
  inFlight: number;
  lastActivityAt: number;
}

export async function loadActivity(): Promise<ActivitySnapshot> {
  return (await browser.runtime.sendMessage({ type: 'activity' })) as ActivitySnapshot;
}

const REASONS: Record<string, MessageKey> = {
  paused: 'reason_paused',
  feature_disabled: 'reason_feature_disabled',
  forbidden: 'reason_forbidden',
  denied: 'reason_denied',
};

/**
 * A group with nothing in it says so in its description, and its empty card is not drawn:
 * libadwaita's own pattern for an empty preferences group.
 */
export function markEmpty(group: Adw.PreferencesGroup, emptyText: string | null): void {
  group.classList.toggle('empty', emptyText !== null);
  if (emptyText !== null) group.setAttribute('description', emptyText);
  else group.removeAttribute('description');
}

const shownLogs = new WeakMap<HTMLElement, string>();

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(uiLanguage(), { hour: '2-digit', minute: '2-digit' });

/**
 * One row per request, newest first: the action's icon, what it did, where and when. What the
 * agent typed goes in the hover text, not on the row. With `limit`, a "Show all" row follows
 * when there is more, calling `onShowAll`. `showSession: false` leaves the session label out, for a
 * popup with only one session connected. Redrawn only when the log changed. Returns how many
 * entries the log holds.
 */
export function renderActivity(
  group: Adw.PreferencesGroup,
  log: ActivityEntry[],
  options: { limit?: number; onShowAll?: () => void; showSession?: boolean } = {},
): number {
  const showSession = options.showSession ?? true;
  const key = JSON.stringify([log, showSession]);
  if (shownLogs.get(group) === key) return log.length;
  shownLogs.set(group, key);
  for (const old of group.querySelectorAll('adw-action-row, adw-button-row')) group.removeRow(old);
  group.classList.toggle('empty', log.length === 0);
  const shown = options.limit === undefined ? log : log.slice(0, options.limit);
  for (const entry of shown) {
    const row = document.createElement('adw-action-row');
    row.className = `activity-${entry.outcome}`;
    row.setAttribute('title', methodWords(entry.method));
    // The session label comes from the agent's side: an attribute value, never markup.
    const session = showSession ? entry.session : undefined;
    row.setAttribute('subtitle', [entry.host, clock(entry.at), session].filter(Boolean).join(' · '));
    row.append(prefixIcon(methodIcon(entry.method)));
    if (entry.outcome !== 'ok') {
      const reason = document.createElement('span');
      reason.slot = 'suffix';
      reason.className = 'caption activity-reason';
      const known = entry.reason ? REASONS[entry.reason] : undefined;
      reason.textContent = t(known ?? 'reason_failed');
      // The raw reason is English wire text: detail for whoever hovers, not the row's words.
      if (!known && entry.reason) reason.title = entry.reason;
      row.append(reason);
    }
    group.addRow(row);
    if (entry.preview) hoverText(row, entry.preview);
  }
  if (options.onShowAll && log.length > shown.length) {
    const more = document.createElement('adw-button-row');
    more.setAttribute('title', t('activity_show_all'));
    more.setAttribute('end-icon-name', 'go-next-symbolic');
    more.addEventListener('activated', options.onShowAll);
    group.addRow(more);
  }
  return log.length;
}
