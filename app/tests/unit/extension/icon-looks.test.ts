import { describe, expect, it } from '@gjsify/unit';

import { CONNECTED, LOOK_COLOUR, TOOLBAR_INK } from '@beifahrer/core';

import { ICON_VARIANTS } from '../../../../extension/manifest.ts';
import { MIN_OPAQUE_SHARE, opaqueShare, variantSvg } from '../../../../extension/scripts/icon-looks.ts';

const SRC = '<svg viewBox="0 0 16 16"><g fill="#241f31"><rect/></g></svg>';

export default async () => {
  await describe('toolbar icon artwork', async () => {
    await it('rejects an empty or near-invisible raster', async () => {
      const empty = new Uint8Array(16 * 16 * 4);
      const faint = new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 40 : 0));
      expect(opaqueShare(empty, 4) < MIN_OPAQUE_SHARE).toBe(true);
      expect(opaqueShare(faint, 4) < MIN_OPAQUE_SHARE).toBe(true);
    });

    await it('accepts a solid raster', async () => {
      const solid = new Uint8Array(16 * 16 * 4).fill(255);
      expect(opaqueShare(solid, 4) >= MIN_OPAQUE_SHARE).toBe(true);
    });

    await it('gives every state its own dot, and no variant is dotless', async () => {
      const dots = Object.values(LOOK_COLOUR);
      for (const variant of ICON_VARIANTS)
        expect(variantSvg(SRC, SRC, variant).includes('<circle')).toBe(true);
      expect(LOOK_COLOUR.idle).toBe(CONNECTED);
      expect(new Set(dots).size).toBe(4);
    });

    await it('paints the monochrome bus in the toolbar ink and leaves the colour bus alone', async () => {
      const colour = '<svg><path fill="#3584e4"/></svg>';
      expect(variantSvg(colour, SRC, 'idle').includes(TOOLBAR_INK.dark)).toBe(true);
      expect(variantSvg(colour, SRC, 'idle', 'dark').includes('#241f31')).toBe(false);
      expect(variantSvg(colour, SRC, 'idle', 'light').includes(`fill="${TOOLBAR_INK.light}"`)).toBe(true);
      expect(variantSvg(colour, SRC, 'idle', 'light').includes(TOOLBAR_INK.dark)).toBe(false);
      expect(variantSvg(colour, SRC, 'active', 'light')).toBe(variantSvg(colour, SRC, 'active', 'dark'));
    });
  });
};
