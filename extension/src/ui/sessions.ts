/**
 * The popup's list of connected agent sessions (ADR 0007): one row per session with its label,
 * since when, and a Disconnect button. Disconnecting closes that session's socket and ignores its
 * bridge until it restarts. The labels come from the bridges, the agent's side, so they only ever
 * reach the DOM as attribute values and text, never as markup.
 */

import { browser } from '@wxt-dev/browser';
import type { SessionView } from '@beifahrer/core';
import type { Adw, Gtk } from '@gjsify/adwaita-web';
import type { Status } from '../bridge-client.ts';
import { t, uiLanguage } from '../i18n.ts';
import { markEmpty } from './features.ts';

export const DISCONNECT_MESSAGE = 'disconnect-session';

let shown = '';

export function renderSessions(group: Adw.PreferencesGroup, status: Status | undefined): void {
  const sessions: SessionView[] = status && status.state !== 'unpaired' ? status.sessions : [];
  const key = JSON.stringify(sessions);
  if (key === shown) return;
  shown = key;
  for (const old of group.querySelectorAll('adw-action-row')) old.remove();
  markEmpty(group, sessions.length === 0 ? t('agents_none') : null);
  for (const s of sessions) {
    const row = document.createElement('adw-action-row');
    row.setAttribute('title', s.label);
    const since = new Date(s.since).toLocaleTimeString(uiLanguage(), { hour: '2-digit', minute: '2-digit' });
    row.setAttribute('subtitle', t('agent_since', since));
    const button = document.createElement('gtk-button') as Gtk.Button;
    button.setAttribute('slot', 'suffix');
    button.setAttribute('label', t('agent_disconnect'));
    button.setAttribute('tooltip-text', t('agent_disconnect_tooltip'));
    button.toggleAttribute('flat', true);
    button.addEventListener('click', () => {
      button.toggleAttribute('disabled', true);
      void browser.runtime.sendMessage({ type: DISCONNECT_MESSAGE, port: s.port });
    });
    row.append(button);
    group.addRow(row);
    row
      .querySelector('.adw-row-text')
      ?.setAttribute(
        'title',
        s.pid
          ? t('agent_details_pid', s.port, s.pid, s.bridgeVersion)
          : t('agent_details', s.port, s.bridgeVersion),
      );
  }
}
