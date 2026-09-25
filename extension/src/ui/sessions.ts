/**
 * The popup's list of connected agent sessions (ADR 0007): one line per session with its label,
 * since when, and a Disconnect button. Disconnecting closes that session's socket and ignores its
 * bridge until it restarts. The labels come from the bridges, the agent's side, so they are set
 * as text, never as markup.
 */

import { browser } from '@wxt-dev/browser';
import type { SessionView } from '@beifahrer/core';
import type { Status } from '../bridge-client.ts';

export const DISCONNECT_MESSAGE = 'disconnect-session';

export function renderSessions(list: HTMLElement, empty: HTMLElement, status: Status | undefined): void {
  const sessions: SessionView[] = status && status.state !== 'unpaired' ? status.sessions : [];
  list.replaceChildren();
  empty.hidden = sessions.length > 0;
  for (const s of sessions) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = s.label;
    name.title = `port ${s.port}${s.pid ? `, pid ${s.pid}` : ''}, bridge ${s.bridgeVersion}`;
    const since = document.createElement('time');
    since.className = 'muted';
    since.textContent = ` since ${new Date(s.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = 'Disconnect';
    button.title = 'Close this session’s connection. It stays closed until the agent session restarts.';
    button.addEventListener('click', () => {
      button.disabled = true;
      void browser.runtime.sendMessage({ type: DISCONNECT_MESSAGE, port: s.port });
    });
    item.append(name, since, ' ', button);
    list.append(item);
  }
}
