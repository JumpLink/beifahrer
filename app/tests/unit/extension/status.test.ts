import { describe, expect, it } from '@gjsify/unit';

import { alarmOf, type Overall } from '@beifahrer/core';
import {
  BANNERS,
  DISCONNECTED,
  heroIcon,
  isDisconnected,
  STATE_WORDS,
  stateOf,
  type UiState,
} from '../../../../extension/src/ui/status.ts';

/**
 * The popup's and the options' one word of state, in the toolbar button's order (ADR 0014).
 *
 * The suite lives in the app workspace because that is where the unit-test harness is. This file is
 * pure and reaches nothing but core at run time (`status.ts` types its message keys from the
 * catalogue, and takes the connection instead of the background's status), so it runs on Node and
 * GJS like every other suite here — which the app's tsconfig would not allow if it pulled the
 * extension's browser code into the app's program.
 */

/** Every connection the background can report, plus the one no token gives. */
const EVERY: (Overall | 'unpaired')[] = ['connected', 'offline', 'unauthorized', 'protocol', 'unpaired'];
const MISSING = EVERY.filter((c) => c !== 'connected');
const QUIET: UiState[] = ['ready', 'working'];
const BUSY = { inFlight: 2, lastActivityAt: Date.now() };

const sameList = (actual: readonly string[], expected: readonly string[]): void => {
  expect(JSON.stringify([...actual].sort())).toBe(JSON.stringify([...expected].sort()));
};

export default async () => {
  await describe('stateOf: the ladder', async () => {
    await it('names the missing bridge before the pause, and the pause before the quiet looks', async () => {
      // Not connected wins, so every one of these reads as its own reason and not as "paused".
      for (const connection of MISSING) {
        for (const paused of [false, true]) expect(stateOf(connection, paused)).toBe(connection);
      }
      expect(stateOf('connected', true)).toBe('paused');
      expect(stateOf('connected', false)).toBe('ready');
    });
    await it('is the pause that outranks the activity, not the other way round', async () => {
      expect(stateOf('connected', true, BUSY)).toBe('paused');
      expect(stateOf('connected', false, BUSY)).toBe('working');
    });
    await it('counts an unanswered background as no token, the loudest state there is', async () => {
      expect(stateOf(undefined, false)).toBe('unpaired');
      expect(stateOf(undefined, true)).toBe('unpaired');
    });
    await it('agrees with the toolbar button about what needs attention', async () => {
      for (const connection of [...EVERY, undefined]) {
        for (const paused of [false, true]) {
          expect(isDisconnected(stateOf(connection, paused))).toBe(
            alarmOf({ connection: connection ?? 'unpaired', paused }) === 'disconnected',
          );
        }
      }
    });
  });

  await describe('heroIcon: the same looks as the button', async () => {
    await it('paints the red look whenever nothing is connected', async () => {
      for (const connection of MISSING) {
        for (const paused of [false, true]) {
          expect(heroIcon(stateOf(connection, paused))).toBe('offline');
          // Not even a live grant: with no bridge there is nothing to grant anything to.
          expect(heroIcon(stateOf(connection, paused), true)).toBe('offline');
        }
      }
      expect(heroIcon(stateOf(undefined, false))).toBe('offline');
    });
    await it('paints the yellow look while connected and paused, grant or not', async () => {
      expect(heroIcon('paused')).toBe('paused');
      expect(heroIcon('paused', true)).toBe('paused');
    });
    await it('leaves the two connected looks alone', async () => {
      expect(heroIcon('ready')).toBe('idle');
      expect(heroIcon('working')).toBe('active');
      expect(heroIcon('ready', true)).toBe('wide');
      expect(heroIcon('working', true)).toBe('wide-active');
    });
  });

  await describe('the banner table', async () => {
    await it('classifies every state once, loudest to quietest', async () => {
      sameList(DISCONNECTED, ['unpaired', 'offline', 'unauthorized', 'protocol']);
      const states: UiState[] = [...QUIET, 'paused', ...DISCONNECTED];
      sameList(states, Object.keys(STATE_WORDS));
      for (const state of states) expect(isDisconnected(state)).toBe(DISCONNECTED.includes(state));
    });
    await it('speaks red for a missing bridge and yellow for the pause', async () => {
      for (const state of DISCONNECTED) {
        // The first run is the one exception: it gets its own page, not a strip (ADR 0009).
        if (state === 'unpaired') continue;
        expect(BANNERS[state]?.severity).toBe('error');
      }
      expect(BANNERS.paused?.severity).toBe('warning');
    });
    await it('says nothing while nothing is wrong', async () => {
      for (const state of QUIET) expect(BANNERS[state]).toBe(undefined);
    });
    await it('offers the resume for the pause and the settings for every missing bridge', async () => {
      expect(BANNERS.paused?.fix).toBe('resume');
      expect(BANNERS.offline?.fix).toBe('settings');
      expect(BANNERS.unauthorized?.fix).toBe('settings');
      expect(BANNERS.protocol?.fix).toBe('settings');
      // Never paired is the first run: the popup gives it its own page, not a strip above controls
      // that cannot do anything yet (ADR 0009).
      expect(BANNERS.unpaired).toBe(undefined);
    });
  });
};
