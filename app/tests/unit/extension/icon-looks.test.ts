import { describe, expect, it } from '@gjsify/unit';

import { CONNECTED, LOOK_COLOUR } from '@beifahrer/core';

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
  });
};
