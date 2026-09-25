import { describe, expect, it } from '@gjsify/unit';

import { formatShortcut } from '@beifahrer/core';

export default async () => {
  await describe('formatShortcut on mac', async () => {
    await it('renders Alt+Shift as Option+Shift glyphs, no separator', async () => {
      expect(formatShortcut('Alt+Shift+B', 'mac')).toBe('⌥⇧B');
    });

    await it('renders MacCtrl as the actual Control glyph', async () => {
      expect(formatShortcut('MacCtrl+Shift+B', 'mac')).toBe('⌃⇧B');
    });

    await it('renders Command, and Ctrl (Chrome’s mac alias for it), as ⌘', async () => {
      expect(formatShortcut('Command+Shift+B', 'mac')).toBe('⇧⌘B');
      expect(formatShortcut('Ctrl+Shift+B', 'mac')).toBe('⇧⌘B');
    });

    await it("orders modifiers Apple's way regardless of input order", async () => {
      expect(formatShortcut('Shift+Command+Alt+MacCtrl+B', 'mac')).toBe('⌃⌥⇧⌘B');
    });

    await it('passes through a value an engine already rendered as glyphs', async () => {
      expect(formatShortcut('⌥⇧B', 'mac')).toBe('⌥⇧B');
    });

    await it('keeps an unrecognised modifier word out of the glyph set', async () => {
      expect(formatShortcut('Fn+B', 'mac')).toBe('B');
    });
  });

  await describe('formatShortcut off mac', async () => {
    await it('leaves the browser’s own spelling alone', async () => {
      expect(formatShortcut('Alt+Shift+B', 'win')).toBe('Alt+Shift+B');
      expect(formatShortcut('Alt+Shift+B', 'linux')).toBe('Alt+Shift+B');
      expect(formatShortcut('Alt+Shift+B', '')).toBe('Alt+Shift+B');
    });

    await it('still passes through pre-rendered glyphs', async () => {
      expect(formatShortcut('⌥⇧B', 'win')).toBe('⌥⇧B');
    });
  });

  await describe('formatShortcut with no binding', async () => {
    await it('stays empty on every platform', async () => {
      expect(formatShortcut('', 'mac')).toBe('');
      expect(formatShortcut('   ', 'mac')).toBe('');
      expect(formatShortcut('', 'win')).toBe('');
    });
  });
};
