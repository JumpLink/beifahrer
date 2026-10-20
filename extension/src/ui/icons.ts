/**
 * The symbolic icons the pages use that `@gjsify/adwaita-web` does not compile into its
 * stylesheet, supplied the way a GNOME app supplies its own: a GResource, registered with Gio and
 * put on the icon theme's resource path. `<gtk-image icon-name="…">`, `icon-name` on buttons,
 * toggles and status pages then resolve them like the package's own (gjsify ADR 0116).
 *
 * The bytes are `data/eu.jumplink.Beifahrer.data.gresource.xml`, compiled by the bundler with
 * `glib-compile-resources` — a build host needs it. The SVGs beside it are the Adwaita glyphs,
 * copied from `@gjsify/adwaita-icons`.
 *
 * Loaded by `ui.js` only (kit.ts): the page scripts must not import this file, or each would
 * bundle `@gjsify/adwaita-web` a second time. Which icon means what is in icon-names.ts.
 */

import { Gio, Gtk } from '@gjsify/adwaita-web';
import resourceBytes from './data/eu.jumplink.Beifahrer.data.gresource.xml';

export function registerIcons(): void {
  Gio.resources_register(Gio.Resource.new_from_data(resourceBytes));
  Gtk.IconTheme.get_for_display(null).add_resource_path('/eu/jumplink/Beifahrer/icons');
}
