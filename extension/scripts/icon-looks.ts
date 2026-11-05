/**
 * The pure half of the icon pipeline (no GdkPixbuf, so a Node test can import it): which look
 * carries a colour bus and which a corner dot, and the SVG text derived from that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOOK_COLOUR, TOOLBAR_INK, type ToolbarInk } from '@beifahrer/core';

import type { IconVariant } from '../manifest.ts';

/** Whether the bus carries its colour, and whether the look leads with a dot. */
export const LOOK: Record<IconVariant, { colour: boolean; dot: boolean }> = {
  idle: { colour: false, dot: true },
  active: { colour: true, dot: true },
  paused: { colour: false, dot: true },
  offline: { colour: false, dot: true },
  // GNOME's blue 3: not a warning colour, but not the quiet idle look either.
  wide: { colour: false, dot: true },
  'wide-active': { colour: true, dot: true },
};

/** The toolbar source draws everything in this one fill; the monochrome look swaps it for the toolbar's ink. */
const SYMBOLIC_INK = '#241f31';

/**
 * The icon sources (under data/icons/) open with a prolog and a design comment: GdkPixbuf sniffs the
 * first bytes for `<svg` and gives up on the file otherwise, so the derived copy starts at the root
 * element.
 */
export const iconSource = (root: string, ...path: string[]): string => {
  const svg = readFileSync(join(root, '..', 'data', 'icons', ...path), 'utf8');
  return svg.slice(svg.indexOf('<svg'));
};

export function variantSvg(
  colourSource: string,
  symbolicSource: string,
  variant: IconVariant,
  ink: ToolbarInk = 'dark',
): string {
  const { colour, dot } = LOOK[variant];
  let svg = colour ? colourSource : symbolicSource.replaceAll(SYMBOLIC_INK, TOOLBAR_INK[ink]);
  if (!colour && svg === symbolicSource) throw new Error('the symbolic icon lost its fill ' + SYMBOLIC_INK);
  // The dot is the only state signal on the button (no badge), at the bottom right in each
  // source's own units (128 and 16), with a white ring to keep it apart from the bus at 16 px.
  if (dot) {
    const unit = colour ? 1 : 1 / 8;
    svg = svg.replace(
      '</svg>',
      `  <circle cx="${102 * unit}" cy="${102 * unit}" r="${24 * unit}" fill="${LOOK_COLOUR[variant]}" stroke="#ffffff" stroke-width="${6 * unit}"/>\n</svg>`,
    );
  }
  return svg;
}

/** Least share of opaque pixels (alpha >= 128) a toolbar icon may have: the idle bus measures ~0.45. */
export const MIN_OPAQUE_SHARE = 0.3;

/** Share of opaque pixels in an RGBA buffer; the build refuses an icon below `MIN_OPAQUE_SHARE`. */
export function opaqueShare(rgba: Uint8Array, channels: number): number {
  if (channels !== 4) return 1;
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) opaque++;
  return opaque / (rgba.length / 4);
}
