/**
 * Render the toolbar icons from the app's own icon, data/icons/hicolor/: the colour bus
 * (scalable/apps/eu.jumplink.beifahrer.svg) and its symbolic twin. The variants are derived here
 * as SVG text and rasterised to PNG at every size the manifest names, for every browser. On GJS
 * through GdkPixbuf, whose SVG loader is librsvg: the stack a GNOME desktop draws its icons with,
 * so no rasteriser is vendored here.
 *
 *   idle      monochrome + green dot           connected, nothing running
 *   active    colour + green dot               an agent request running, and a few seconds after
 *   paused    monochrome + yellow dot          the person pressed Stop
 *   offline   monochrome + red dot             no bridge connection: no agent reaches this browser
 *   wide      monochrome + blue dot            "all sites" is granted for now (ADR 0010)
 *   wide-active  colour + blue dot             the same, while an agent request runs
 *
 * Every monochrome look is rendered in two inks, because the bus must match the colour of the
 * browser's other toolbar icons (ADR 0025 § 11): `dark` (#333338) for a light toolbar, under the
 * plain file name, and `light` (#ffffff) for a dark one, as `<variant>-light-<size>.png`. The
 * coloured looks have one ink, so both names hold the same picture. src/toolbar.ts picks at runtime.
 *
 * The dot's colour is `LOOK_COLOUR` (core). There is no toolbar badge (ADR 0025 § 11): the dot is
 * the only state signal on the button.
 */

import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIN_OPAQUE_SHARE, opaqueShare, iconSource, variantSvg } from './icon-looks.ts';

import { iconFile, ICON_SIZES, ICON_VARIANTS, type Target } from '../manifest.ts';

const INKS = ['dark', 'light'] as const;

/** Render every variant once into `stage`; `copyIcons` then places what each target needs. */
export function renderIcons(root: string, stage: string): void {
  const colour = iconSource(root, 'scalable', 'apps', 'eu.jumplink.beifahrer.svg');
  const symbolic = iconSource(root, 'symbolic', 'apps', 'eu.jumplink.beifahrer-symbolic.svg');
  mkdirSync(join(stage, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    for (const ink of INKS) {
      const svg = join(stage, 'icons', `${variant}${ink === 'light' ? '-light' : ''}.svg`);
      writeFileSync(svg, variantSvg(colour, symbolic, variant, ink));
      for (const size of ICON_SIZES) {
        const name = iconFile(variant, size, ink);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(svg, size, size);
        const share = opaqueShare(pixbuf.get_pixels(), pixbuf.get_n_channels());
        if (share < MIN_OPAQUE_SHARE) throw new Error(`${name} is nearly empty (${share.toFixed(2)} opaque)`);
        pixbuf.savev(join(stage, 'icons', name), 'png', [], []);
      }
    }
  }
}

export function copyIcons(stage: string, dir: string, _target: Target): void {
  mkdirSync(join(dir, 'icons'), { recursive: true });
  for (const variant of ICON_VARIANTS) {
    const names = INKS.flatMap((ink) => ICON_SIZES.map((size) => iconFile(variant, size, ink)));
    for (const name of names) copyFileSync(join(stage, 'icons', name), join(dir, 'icons', name));
  }
}
