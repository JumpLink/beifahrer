/**
 * `ui.js`, the one script every extension page loads before its own: the page's static text is
 * translated FIRST, then the Adwaita custom elements are defined and upgrade the translated
 * markup. The order is the point — `<adw-toggle>` labels and a few other attributes are read once,
 * at upgrade, so text set afterwards would never reach them.
 *
 * ES modules evaluate their imports in order, so `./localize-page.ts` runs to completion before
 * `@gjsify/adwaita-web` defines anything. The symbolic icons the package does not compile in are
 * registered right after, in the same task, so no element paints before they exist. Shared by the three pages as one file, so the browser
 * parses the Adwaita stylesheet and elements from its cache instead of from three bundles.
 */

import './localize-page.ts';
import '@gjsify/adwaita-web';
// The desktop's accent colour, on every page and live while it is open.
import './accent.ts';
import { registerIcons } from './icons.ts';

registerIcons();
