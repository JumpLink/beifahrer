/**
 * The "Check connection" row on the Status page (ADR 0017 § 7): one button, one sentence. It starts a
 * check and shows its outcome; it has no control over the browser's policy.
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import type { CheckView } from './check-model.ts';

export interface CheckRow {
  widget: Gtk.Widget;
  show(view: CheckView): void;
}

export function createCheckRow(title: string, onCheck: () => void): CheckRow {
  const row = new Adw.ActionRow({ title, subtitleLines: 0 });
  const icon = new Gtk.Image({ visible: false });
  const spinner = new Gtk.Spinner({ visible: false });
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER });
  button.connect('clicked', onCheck);
  row.add_prefix(icon);
  row.add_suffix(spinner);
  row.add_suffix(button);
  const group = new Adw.PreferencesGroup();
  group.add(row);
  return {
    widget: group,
    show(view) {
      row.set_title(view.title);
      row.set_subtitle(view.subtitle);
      button.set_label(view.button);
      button.set_sensitive(!view.busy);
      spinner.set_visible(view.busy);
      spinner.set_spinning(view.busy);
      icon.set_visible(view.icon !== null);
      if (view.icon) icon.set_from_icon_name(view.icon);
    },
  };
}
