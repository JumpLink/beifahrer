import { describe, expect, it } from '@gjsify/unit';

import { toolbarLook, type ToolbarInput } from '@beifahrer/core';

// The toolbar button is how the person sees an agent, and a live "all sites" grant (ADR 0010).
export default async () => {
  const base: ToolbarInput = {
    connection: 'connected',
    paused: false,
    inFlight: 0,
    lastActivityAt: 0,
    now: 10_000,
  };

  await describe('toolbarLook: all sites', async () => {
    await it('shows the wide look while the grant is live, idle or working', async () => {
      expect(toolbarLook({ ...base, wide: true }).icon).toBe('wide');
      expect(toolbarLook({ ...base, wide: true, inFlight: 1 }).icon).toBe('wide-active');
      expect(toolbarLook({ ...base, wide: true }).badge).toBe('*');
    });
    await it('still shows it without an agent: the grant is live all the same', async () => {
      expect(toolbarLook({ ...base, connection: 'offline', wide: true }).icon).toBe('wide');
      expect(toolbarLook({ ...base, connection: 'offline', wide: true, inFlight: 1 }).icon).toBe('wide');
    });
    await it('lets pause win', async () => {
      expect(toolbarLook({ ...base, paused: true, wide: true }).icon).toBe('paused');
    });
    await it('looks as before without a grant', async () => {
      expect(toolbarLook(base).icon).toBe('idle');
      expect(toolbarLook({ ...base, inFlight: 1 }).icon).toBe('active');
      expect(toolbarLook({ ...base, connection: 'offline' }).icon).toBe('offline');
    });
  });
};
