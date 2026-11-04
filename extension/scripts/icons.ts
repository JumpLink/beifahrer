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
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIN_OPAQUE_SHARE, SMALL_MAX, opaqueShare, iconSource, variantSvg } from './icon-looks.ts';

import { ICON_SIZES, ICON_VARIANTS, type Target } from '../manifest.ts';

/** Render every variant once into `stage`; `copyIcons` then places what each target needs. */
export function renderIcons(root: string, stage: string): void {
  const colour = iconSource(root, 'scalable', 'apps', 'eu.jumplink.beifahrer.svg');
  const symbolic = iconSource(root, 'symbolic', 'apps', 'eu.jumplink.beifahrer-symbolic.svg');
  mkdirSync(join(stage, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    for (const size of ICON_SIZES) {
      const small = size <= SMALL_MAX;
      const svg = join(stage, 'icons', `${variant}${small ? '-small' : ''}.svg`);
      writeFileSync(svg, variantSvg(colour, symbolic, variant, small));
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(svg, size, size);
      const share = opaqueShare(pixbuf.get_pixels(), pixbuf.get_n_channels());
      if (share < MIN_OPAQUE_SHARE)
        throw new Error(`${variant}-${size}.png is nearly empty (${share.toFixed(2)} opaque)`);
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
