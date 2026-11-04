/**
 * The pure half of the icon pipeline (no GdkPixbuf, so a Node test can import it): which look
 * carries a colour bus and which a corner dot, and the SVG text derived from that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOOK_COLOUR, MONOCHROME } from '@beifahrer/core';

import type { IconVariant } from '../manifest.ts';

/** Whether the bus carries its colour, and whether the look leads with a dot. */
export const LOOK: Record<IconVariant, { colour: boolean; dot: boolean }> = {
  idle: { colour: false, dot: false },
  active: { colour: true, dot: false },
  paused: { colour: false, dot: true },
  offline: { colour: false, dot: true },
  // GNOME's blue 3: not a warning colour, but not the quiet idle look either.
  wide: { colour: false, dot: true },
  'wide-active': { colour: true, dot: true },
};

/** The symbolic source draws everything in this one fill; the monochrome look swaps it. */
const SYMBOLIC_INK = '#241f31';

/**
 * The app icons open with a prolog and a long design comment: GdkPixbuf sniffs the first bytes for
 * `<svg` and gives up on the file otherwise, so the derived copy starts at the root element.
 */
export const iconSource = (root: string, ...path: string[]): string => {
  const svg = readFileSync(join(root, '..', 'data', 'icons', 'hicolor', ...path), 'utf8');
  return svg.slice(svg.indexOf('<svg'));
};

/** Sizes the toolbar draws, where the browser's badge covers the top right of the button. */
export const SMALL_MAX = 32;

/**
 * `small` is the toolbar artwork: the whole look shrunk into the bottom left, because Firefox
 * paints its badge over the top right ~9 px of a 16 px button and the full-size bus vanished
 * behind it. The dot gets smaller and moves out to the corner so it does not eat a wheel.
 */
export function variantSvg(
  colourSource: string,
  symbolicSource: string,
  variant: IconVariant,
  small = false,
): string {
  const { colour, dot } = LOOK[variant];
  let svg = colour ? colourSource : symbolicSource.replaceAll(SYMBOLIC_INK, MONOCHROME);
  if (!colour && svg === symbolicSource) throw new Error('the symbolic icon lost its fill ' + SYMBOLIC_INK);
  const unit = colour ? 1 : 1 / 8;
  if (small) {
    const open = svg.indexOf('>', svg.indexOf('<svg')) + 1;
    svg =
      svg.slice(0, open) +
      `<g transform="translate(0 ${25.6 * unit}) scale(0.8)">` +
      svg.slice(open, svg.lastIndexOf('</svg>')) +
      '</g></svg>';
  }
  // The dot sits at the bottom right in each source's own units (128 and 16), with a white ring
  // to keep it apart from the bus at 16 px.
  if (dot) {
    const [c, r] = small ? [107, 15] : [102, 24];
    svg = svg.replace(
      '</svg>',
      `  <circle cx="${c * unit}" cy="${c * unit}" r="${r * unit}" fill="${LOOK_COLOUR[variant]}" stroke="#ffffff" stroke-width="${6 * unit}"/>\n</svg>`,
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
