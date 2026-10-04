/**
 * One word of state for the popup's hero and the options header: what the person needs to know
 * at a glance, nothing about ports or processes (those are in the options' Advanced section and
 * the session rows' hover text).
 *
 * The state, its word, its dot and what its banner says are decided here, in one place, in the
 * toolbar's own order (`alarmOf`, core): the two pages render what this file says instead of each
 * deciding for itself what "not normal" means, which is how they end up disagreeing about what is
 * wrong (ADR 0014). Painting the banner is banner.ts; nothing here touches the DOM, so the ladder is
 * a pure function the suite can walk.
 */

import { isActive, type Overall, type ToolbarIcon } from '@beifahrer/core';
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

/**
 * The states in which no agent can reach this browser at all: nothing is paired, or no bridge
 * answered, or one refused us. Every one of them is the `disconnected` rung of the ladder, so every
 * one of them is red, and every one but the first run gets a banner. A new `UiState` has to be
 * listed here or it would read as the loudest thing there is; `stateOf` can only produce the rest.
 */
export const DISCONNECTED: readonly UiState[] = ['unpaired', 'offline', 'unauthorized', 'protocol'];

export function isDisconnected(state: UiState): boolean {
  return DISCONNECTED.includes(state);
}

/**
 * The state's word, in the toolbar button's order (ADR 0014): with no bridge connection the
 * extension can do nothing at all, so that outranks the pause, which outranks the two quiet
 * connected looks. `toolbarLook` (core) walks the same ladder in the same order; the suite pins
 * that the two agree for every connection × pause pair.
 *
 * It takes the connection the background reported rather than the status that carried it, so this
 * file needs nothing from the extension but a message key: the ladder is a pure function the app's
 * unit suite runs on Node and GJS (app/tests/unit/extension/status.test.ts). `undefined` is a
 * background that has not answered, which is no token: the loudest state there is.
 */
export function stateOf(
  connection: Overall | 'unpaired' | undefined,
  paused: boolean,
  activity: { inFlight: number; lastActivityAt: number } = { inFlight: 0, lastActivityAt: 0 },
): UiState {
  const state = connection ?? 'unpaired';
  if (state !== 'connected') return state;
  if (paused) return 'paused';
  return isActive({ ...activity, now: Date.now() }) ? 'working' : 'ready';
}

/**
 * The toolbar's own sparkles, so the hero and the toolbar button always look alike: the same looks
 * in the same order, and `wide` (a live "all sites" grant, ADR 0010) only decorates a connected
 * one, exactly as on the button.
 */
export function heroIcon(state: UiState, wide = false): ToolbarIcon {
  if (isDisconnected(state)) return 'offline';
  if (state === 'paused') return 'paused';
  if (wide) return state === 'working' ? 'wide-active' : 'wide';
  return state === 'working' ? 'active' : 'idle';
}

/** How loudly a state speaks. Also the banner's colour, so the two cannot be picked apart. */
export type Severity = 'error' | 'warning';

/** The one action that fixes the state; a page offers it only if it has that control. */
export type Fix = 'resume' | 'settings';

/**
 * The banner speaks only when something is not normal, with the one action that fixes it.
 *
 * `unpaired` is missing on purpose: never paired is the first run, and the popup shows it as a
 * compact status page with one button (ADR 0009) rather than a strip above controls that cannot do
 * anything yet. `offline` is here because an extension with no bridge does nothing at all, which
 * the person has to fix in the options (the token) or in their agent (start the bridge), so it
 * gets the loudest thing there is where ADR 0009's "no agent running" stayed quiet.
 */
export const BANNERS: Partial<Record<UiState, { title: MessageKey; fix: Fix; severity: Severity }>> = {
  paused: { title: 'state_paused', fix: 'resume', severity: 'warning' },
  offline: { title: 'banner_offline', fix: 'settings', severity: 'error' },
  unauthorized: { title: 'banner_unauthorized', fix: 'settings', severity: 'error' },
  protocol: { title: 'banner_protocol', fix: 'settings', severity: 'error' },
};
