import { describe, expect, it } from '@gjsify/unit';

import {
  alarmOf,
  LOOK_COLOUR,
  MONOCHROME,
  toolbarLook,
  type Connection,
  type ToolbarInput,
} from '@beifahrer/core';

/** Every connection the extension's status can be in; `unpaired` is what no token gives. */
const CONNECTIONS: Connection[] = [
  'connected',
  'offline',
  'unpaired',
  'unauthorized',
  'protocol',
  'connecting',
];

// The toolbar button is how the person sees an agent, in the ladder ADR 0014 names: no connection
// first, then the pause, then the live "all sites" grant (ADR 0010), then the two quiet looks.
export default async () => {
  const base: ToolbarInput = {
    connection: 'connected',
    paused: false,
    inFlight: 0,
    lastActivityAt: 0,
    now: 10_000,
  };

  await describe('alarmOf: not connected outranks the pause', async () => {
    await it('is quiet only while a bridge is connected and the person has not paused', async () => {
      expect(alarmOf({ connection: 'connected', paused: false })).toBe('none');
      expect(alarmOf({ connection: 'connected', paused: true })).toBe('paused');
      for (const connection of CONNECTIONS.filter((c) => c !== 'connected')) {
        expect(alarmOf({ connection, paused: false })).toBe('disconnected');
        expect(alarmOf({ connection, paused: true })).toBe('disconnected');
      }
    });
  });

  await describe('toolbarLook: every connection x pause', async () => {
    await it('shows the red look whenever nothing is connected, pause or not', async () => {
      for (const connection of CONNECTIONS.filter((c) => c !== 'connected')) {
        for (const paused of [false, true]) {
          const look = toolbarLook({ ...base, connection, paused });
          expect(look.icon).toBe('offline');
          expect(look.badge).toBe('!');
          // The colour never says it alone, so the tooltip has to name a reason too.
          expect(look.title.length > 'Beifahrer — '.length).toBe(true);
        }
      }
    });
    await it('gives each refusing connection its own words', async () => {
      const titles = CONNECTIONS.filter((c) => c !== 'connected').map(
        (connection) => toolbarLook({ ...base, connection }).title,
      );
      expect(new Set(titles).size).toBe(titles.length);
    });
    await it('shows the yellow look only while connected and paused', async () => {
      for (const wide of [false, true]) {
        for (const inFlight of [0, 1]) {
          const look = toolbarLook({ ...base, paused: true, wide, inFlight });
          expect(look.icon).toBe('paused');
          expect(look.badge).toBe('II');
        }
      }
    });
    await it('stays quiet while connected and not paused', async () => {
      expect(toolbarLook(base).icon).toBe('idle');
      expect(toolbarLook({ ...base, inFlight: 1 }).icon).toBe('active');
    });
  });

  await describe('toolbarLook: all sites', async () => {
    await it('shows the wide look while the grant is live, idle or working', async () => {
      expect(toolbarLook({ ...base, wide: true }).icon).toBe('wide');
      expect(toolbarLook({ ...base, wide: true, inFlight: 1 }).icon).toBe('wide-active');
      expect(toolbarLook({ ...base, wide: true }).badge).toBe('*');
    });
    await it('does not paint a live grant over a missing bridge: that one is red (ADR 0014)', async () => {
      expect(toolbarLook({ ...base, connection: 'offline', wide: true }).icon).toBe('offline');
      expect(toolbarLook({ ...base, connection: 'offline', wide: true, inFlight: 1 }).icon).toBe('offline');
    });
    await it('lets the missing bridge and the pause win', async () => {
      expect(toolbarLook({ ...base, paused: true, wide: true }).icon).toBe('paused');
      expect(toolbarLook({ ...base, connection: 'offline', paused: true, wide: true }).icon).toBe('offline');
    });
  });

  await describe('LOOK_COLOUR: one table for the icon dot and the badge', async () => {
    await it('paints the three loud looks red, yellow and blue (ADR 0014)', async () => {
      expect(LOOK_COLOUR.offline).toBe('#e01b24');
      expect(LOOK_COLOUR.paused).toBe('#e5a50a');
      expect(LOOK_COLOUR.wide).toBe('#3584e4');
      expect(LOOK_COLOUR['wide-active']).toBe(LOOK_COLOUR.wide);
    });
    await it('keeps the quiet looks the mid grey a light and a dark toolbar both read', async () => {
      expect(LOOK_COLOUR.idle).toBe(MONOCHROME);
    });
  });
};
