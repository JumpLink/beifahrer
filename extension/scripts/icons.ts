/**
 * Render the toolbar icons from ONE source, icons/sparkles.svg: the variants are derived here as
 * SVG text, and rasterised to PNG for Chromium at every size the manifest names. On GJS through
 * GdkPixbuf, whose SVG loader is librsvg: the stack a GNOME desktop draws its icons with, so no
 * rasteriser is vendored here. Firefox gets the variant SVGs themselves (manifest.ts `iconPaths`).
 *
 *   idle      monochrome sparkles              connected, nothing running
 *   active    the sparkles in colour           an agent request running, and a few seconds after
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

import { ICON_SIZES, ICON_VARIANTS, isSmall, type IconVariant, type Target } from '../manifest.ts';

/** Whether the sparkles carry their colour, and whether the look leads with a dot. */
const LOOK: Record<IconVariant, { colour: boolean; dot: boolean }> = {
  idle: { colour: false, dot: false },
  active: { colour: true, dot: false },
  paused: { colour: false, dot: true },
  offline: { colour: false, dot: true },
  // GNOME's blue 3: not a warning colour, but not the quiet idle look either.
  wide: { colour: false, dot: true },
  'wide-active': { colour: true, dot: true },
};

export function variantSvg(source: string, variant: IconVariant): string {
  const { colour, dot } = LOOK[variant];
  let svg = colour ? source : source.replace('fill="url(#colour)"', `fill="${MONOCHROME}"`);
  if (svg === source && !colour)
    throw new Error('icons/sparkles.svg: #sparkles lost its fill="url(#colour)"');
  // A white ring keeps the dot apart from the sparkles at 16 px.
  if (dot)
    svg = svg.replace(
      '</svg>',
      `  <circle cx="102" cy="102" r="24" fill="${LOOK_COLOUR[variant]}" stroke="#ffffff" stroke-width="6"/>\n</svg>`,
    );
  return svg;
}

/** Render every variant once into `stage`; `copyIcons` then places what each target needs. */
export function renderIcons(root: string, stage: string): void {
  const source = readFileSync(join(root, 'icons', 'sparkles.svg'), 'utf8');
  // Toolbar sizes get their own, fuller form — see the comment in icons/sparkles-small.svg.
  const small = readFileSync(join(root, 'icons', 'sparkles-small.svg'), 'utf8');
  mkdirSync(join(stage, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    const svg = join(stage, 'icons', `${variant}.svg`);
    const svgSmall = join(stage, 'icons', `${variant}-small.svg`);
    writeFileSync(svg, variantSvg(source, variant));
    writeFileSync(svgSmall, variantSvg(small, variant));
    for (const size of ICON_SIZES) {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(isSmall(size) ? svgSmall : svg, size, size);
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
