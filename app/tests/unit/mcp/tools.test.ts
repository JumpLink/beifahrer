import { describe, expect, it } from '@gjsify/unit';

import { applyReadOnlyGate } from '../../../src/frontends/mcp/runtime.ts';
import { registerTools } from '../../../src/frontends/mcp/tools.ts';
import { createRecorder } from './recorder.ts';

const READ = [
  'browsers_list',
  'tabs_list',
  'tab_active',
  'page_read',
  'page_outline',
  'page_screenshot',
  'sessions_list',
  'sessions_recently_closed',
];
const WRITE = [
  'page_fill',
  'page_click',
  'tab_open',
  'tabs_move',
  'tabs_pin',
  'tabs_close',
  'tabs_group',
  'tabs_ungroup',
  'window_create',
  'sessions_save',
  'sessions_restore',
  'sessions_delete',
  'sessions_define',
  'sessions_restore_closed',
];

export default async () => {
  await describe('tool catalogue', async () => {
    await it('exposes only the read tools by default', async () => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, false);
      registerTools(rec.server, { bridge: null });
      expect(rec.names().sort()).toEqualArray([...READ].sort());
    });

    await it('adds exactly the write tools when writes are allowed', async () => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, true);
      registerTools(rec.server, { bridge: null });
      expect(rec.names().sort()).toEqualArray([...READ, ...WRITE].sort());
    });

    await it("tells the agent that forbidden is the person's decision", async () => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, true);
      registerTools(rec.server, { bridge: null });
      for (const name of [
        'tabs_list',
        'page_read',
        'page_outline',
        'page_fill',
        'page_click',
        ...WRITE.filter((n) => n.startsWith('tabs_') || n.startsWith('sessions_')),
        'sessions_list',
      ]) {
        expect(rec.find(name)?.description ?? '').toMatch(/not a malfunction/);
      }
    });
  });
};
