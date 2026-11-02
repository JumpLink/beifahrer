import { describe, expect, it } from '@gjsify/unit';

import { pickMode } from '../../src/dispatch.ts';

export default async () => {
  await describe('pickMode: one binary, a window or the CLI', async () => {
    await it('opens the window when started without arguments (a double-click)', async () => {
      expect(pickMode([])).toBe('window');
    });

    await it('opens the window for the explicit `window` command', async () => {
      expect(pickMode(['window'])).toBe('window');
    });

    await it('stays the CLI for every command a coding agent or a terminal runs', async () => {
      for (const args of [
        ['mcp'],
        ['mcp', '--allow-write'],
        ['token'],
        ['status'],
        ['doctor'],
        ['config'],
        ['serve'],
        ['call', 'tabs.list'],
        ['tool', '--list'],
        ['--help'],
        ['--version'],
      ])
        expect(`${args.join(' ')}:${pickMode(args)}`).toBe(`${args.join(' ')}:cli`);
    });

    await it('does not take `window` for the window when it carries more arguments', async () => {
      expect(pickMode(['window', '--help'])).toBe('cli');
    });
  });
};
