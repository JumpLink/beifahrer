// S6: which of the icons the window names does the icon theme resolve, and from where does it search?
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';

const NAMES = [
  'emblem-ok-symbolic',
  'object-select-symbolic',
  'dialog-warning-symbolic',
  'edit-copy-symbolic',
  'network-transmit-receive-symbolic',
  'web-browser-symbolic',
  'utilities-terminal-symbolic',
  'image-missing',
];

const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer.Probe',
  createWindow: (app) => {
    const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default()!);
    console.log(`[icons] theme=${theme.get_theme_name()} search=${theme.get_search_path()?.join(':')}`);
    console.log(`[icons] data dirs=${GLib.get_system_data_dirs().join(':')}`);
    for (const n of NAMES) console.log(`[icons] ${n}: ${theme.has_icon(n)}`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => (app.quit(), GLib.SOURCE_REMOVE));
    return new Adw.ApplicationWindow({ application: app });
  },
});
process.exit(code);
