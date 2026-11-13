import { describe, expect, it } from '@gjsify/unit';

import { extensionIsOlder, outdatedExtensionNote, parseVersion } from '@beifahrer/core';

export default async () => {
  await describe('outdated extension (issue #210)', async () => {
    await it('parses x.y.z and refuses anything else', async () => {
      expect(parseVersion('0.1.30')?.join('.')).toBe('0.1.30');
      expect(parseVersion('1.2.3-beta.1')?.join('.')).toBe('1.2.3');
      expect(parseVersion('dev')).toBe(null);
      expect(parseVersion('')).toBe(null);
    });

    await it('is older only when strictly older, numerically', async () => {
      expect(extensionIsOlder('0.1.9', '0.1.30')).toBe(true);
      expect(extensionIsOlder('0.1.30', '0.1.30')).toBe(false);
      expect(extensionIsOlder('0.2.0', '0.1.30')).toBe(false);
      expect(extensionIsOlder('1.0.0', '0.9.9')).toBe(false);
    });

    await it('never claims outdated for an unparseable version', async () => {
      expect(extensionIsOlder('dev', '0.1.30')).toBe(false);
      expect(extensionIsOlder('0.1.0', 'test')).toBe(false);
      expect(outdatedExtensionNote('dev', '0.1.30')).toBe(null);
    });

    await it('names both versions and the next move', async () => {
      const note = outdatedExtensionNote('0.1.0', '0.1.30') ?? '';
      expect(note.includes('0.1.0')).toBe(true);
      expect(note.includes('0.1.30')).toBe(true);
      expect(note.includes('update the extension')).toBe(true);
    });
  });
};
