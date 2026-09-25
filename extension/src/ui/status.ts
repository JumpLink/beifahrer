/**
 * One word of state for the popup's hero and the options header: what the person needs to know
 * at a glance, nothing about ports or processes (those are in the options' Advanced section and
 * the session rows' hover text).
 */

import { isActive, type ToolbarIcon } from '@beifahrer/core';
import type { Status } from '../bridge-client.ts';
import type { MessageKey } from '../i18n.ts';

export type UiState = 'ready' | 'working' | 'paused' | 'offline' | 'unpaired' | 'unauthorized' | 'protocol';

export const STATE_WORDS: Record<UiState, MessageKey> = {
  ready: 'state_ready',
  working: 'state_working',
  paused: 'state_paused',
  offline: 'state_offline',
  unpaired: 'state_unpaired',
  unauthorized: 'state_unauthorized',
  protocol: 'state_protocol',
};

/** Paused wins over everything: it is the person's own switch, and the agent gets nothing. */
export function stateOf(
  status: Status | undefined,
  paused: boolean,
  activity: { inFlight: number; lastActivityAt: number } = { inFlight: 0, lastActivityAt: 0 },
): UiState {
  if (paused) return 'paused';
  const s = status?.state ?? 'unpaired';
  if (s !== 'connected') return s;
  return isActive({ ...activity, now: Date.now() }) ? 'working' : 'ready';
}

/**
 * The toolbar's own sparkles, so the hero and the toolbar button always look alike. `wide`: a
 * temporary "all sites" grant is live (ADR 0010), which only a pause outranks, as on the button.
 */
export function heroIcon(state: UiState, wide = false): ToolbarIcon {
  if (state === 'paused') return 'paused';
  if (wide) return state === 'working' ? 'wide-active' : 'wide';
  if (state === 'working') return 'active';
  if (state === 'ready') return 'idle';
  return 'offline';
}
