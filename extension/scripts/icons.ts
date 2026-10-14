/**
 * Render the toolbar icons from the app's own icon, data/icons/hicolor/: the colour bus
 * (scalable/apps/eu.jumplink.beifahrer.svg) and its symbolic twin. The variants are derived here
 * as SVG text and rasterised to PNG at every size the manifest names, for every browser. On GJS
 * through GdkPixbuf, whose SVG loader is librsvg: the stack a GNOME desktop draws its icons with,
 * so no rasteriser is vendored here.
 *
 *   idle      monochrome bus                   connected, nothing running
 *   active    the bus in colour                an agent request running, and a few seconds after
 *   paused    monochrome + yellow dot          the person pressed Stop
 *   offline   monochrome + red dot             no bridge connection: no agent reaches this browser
 *   wide      monochrome + blue dot            "all sites" is granted for now (ADR 0010)
 *   wide-active  colour + blue dot             the same, while an agent request runs
 *
 * The dot's colour is `LOOK_COLOUR` (core), the one table the badge fallback paints from too, so
 * the icon and the badge of a browser without `setIcon` cannot say different states.
 */

import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOOK_COLOUR, MONOCHROME } from '@beifahrer/core';

import { ICON_SIZES, ICON_VARIANTS, type IconVariant, type Target } from '../manifest.ts';

/** Whether the bus carries its colour, and whether the look leads with a dot. */
const LOOK: Record<IconVariant, { colour: boolean; dot: boolean }> = {
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
const iconSource = (root: string, ...path: string[]): string => {
  const svg = readFileSync(join(root, '..', 'data', 'icons', 'hicolor', ...path), 'utf8');
  return svg.slice(svg.indexOf('<svg'));
};

export function variantSvg(colourSource: string, symbolicSource: string, variant: IconVariant): string {
  const { colour, dot } = LOOK[variant];
  let svg = colour ? colourSource : symbolicSource.replaceAll(SYMBOLIC_INK, MONOCHROME);
  if (!colour && svg === symbolicSource) throw new Error('the symbolic icon lost its fill ' + SYMBOLIC_INK);
  // The dot sits at the bottom right in each source's own units (128 and 16), with a white ring
  // to keep it apart from the bus at 16 px.
  if (dot) {
    const unit = colour ? 1 : 1 / 8;
    svg = svg.replace(
      '</svg>',
      `  <circle cx="${102 * unit}" cy="${102 * unit}" r="${24 * unit}" fill="${LOOK_COLOUR[variant]}" stroke="#ffffff" stroke-width="${6 * unit}"/>\n</svg>`,
    );
  }
  return svg;
}

/** Render every variant once into `stage`; `copyIcons` then places what each target needs. */
export function renderIcons(root: string, stage: string): void {
  const colour = iconSource(root, 'scalable', 'apps', 'eu.jumplink.beifahrer.svg');
  const symbolic = iconSource(root, 'symbolic', 'apps', 'eu.jumplink.beifahrer-symbolic.svg');
  mkdirSync(join(stage, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    const svg = join(stage, 'icons', `${variant}.svg`);
    writeFileSync(svg, variantSvg(colour, symbolic, variant));
    for (const size of ICON_SIZES) {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(svg, size, size);
      pixbuf.savev(join(stage, 'icons', `${variant}-${size}.png`), 'png', [], []);
    }
  }
}

export function copyIcons(stage: string, dir: string, _target: Target): void {
  mkdirSync(join(dir, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    const names = ICON_SIZES.map((size) => `${variant}-${size}.png`);
    for (const name of names) copyFileSync(join(stage, 'icons', name), join(dir, 'icons', name));
  }
}
