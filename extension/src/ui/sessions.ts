/**
 * The popup's list of connected agent sessions (ADR 0007): one row per session with its label,
 * since when, and a Disconnect icon button. Port, PID and bridge version are the row's hover
 * text: detail for whoever looks, not words on the row. Disconnecting closes that session's socket and ignores its
 * bridge until it restarts. The labels come from the bridges, the agent's side, so they only ever
 * reach the DOM as attribute values and text, never as markup.
 */

import { browser } from '@wxt-dev/browser';
import type { SessionView } from '@beifahrer/core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../bridge-client.ts';
import { t, uiLanguage } from '../i18n.ts';
import { hoverText, prefixIcon } from './features.ts';

export const DISCONNECT_MESSAGE = 'disconnect-session';

let shown = '';

export function renderSessions(group: Adw.PreferencesGroup, status: Status | undefined): void {
  const sessions: SessionView[] = status && status.state !== 'unpaired' ? status.sessions : [];
  const key = JSON.stringify(sessions);
  if (key === shown) return;
  shown = key;
  for (const old of group.querySelectorAll('adw-action-row')) old.remove();
  // No agent is not a problem (agents start and stop), so an empty list is simply not shown.
  group.hidden = sessions.length === 0;
  for (const s of sessions) {
    const row = document.createElement('adw-action-row');
    row.setAttribute('title', s.label);
    const since = new Date(s.since).toLocaleTimeString(uiLanguage(), { hour: '2-digit', minute: '2-digit' });
    row.setAttribute('subtitle', t('agent_since', since));
    row.append(prefixIcon('utilities-terminal-symbolic'));
    const button = document.createElement('gtk-button') as Gtk.Button;
    button.setAttribute('slot', 'suffix');
    button.setAttribute('icon-name', 'window-close-symbolic');
    // An icon-only button takes its accessible name from the tooltip.
    button.setAttribute('tooltip-text', t('action_disconnect'));
    button.toggleAttribute('flat', true);
    button.toggleAttribute('circular', true);
    button.addEventListener('click', () => {
      button.toggleAttribute('disabled', true);
      void browser.runtime.sendMessage({ type: DISCONNECT_MESSAGE, port: s.port });
    });
    row.append(button);
    group.addRow(row);
    hoverText(
      row,
      s.pid
        ? t('agent_details_pid', s.port, s.pid, s.bridgeVersion)
        : t('agent_details', s.port, s.bridgeVersion),
    );
  }
}
