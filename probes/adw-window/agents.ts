// S5: does the Agent page re-render when the combo row and the switch change, on GJS and node-gi?
// Walks the widget tree (generic, same on both runtimes), drives the two controls, reads the snippet.
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';

import { createTranslate } from '../../desktop/src/i18n.ts';
import { createWindow } from '../../desktop/src/window.ts';

const t = createTranslate('en');

function find(root: Gtk.Widget, match: (w: Gtk.Widget) => boolean): Gtk.Widget | null {
  if (match(root)) return root;
  for (let c = root.get_first_child(); c; c = c.get_next_sibling()) {
    const hit = find(c, match);
    if (hit) return hit;
  }
  return null;
}

const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer.Probe',
  createWindow: (app) => {
    const ui = createWindow(app, t);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      const root = ui.window as unknown as Gtk.Widget;
      const label = () =>
        (find(root, (w) => w instanceof Gtk.Label && w.has_css_class('monospace')) as Gtk.Label).get_label();
      const combo = find(root, (w) => w instanceof Adw.ComboRow) as Adw.ComboRow;
      const sw = find(root, (w) => w instanceof Adw.SwitchRow) as Adw.SwitchRow;
      console.log(`[agents] first: ${JSON.stringify(label().slice(0, 30))}`);
      combo.set_selected(2);
      console.log(`[agents] codex: ${JSON.stringify(label())}`);
      sw.set_active(true);
      console.log(`[agents] codex + write: ${JSON.stringify(label())}`);
      return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => (app.quit(), GLib.SOURCE_REMOVE));
    return ui.window;
  },
});
process.exit(code);
