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
  const icon = new Gtk.Image({ visible: false, valign: Gtk.Align.START, marginTop: 2 });
  const heading = new Gtk.Label({ xalign: 0, wrap: true, label: title });
  const subtitle = new Gtk.Label({ xalign: 0, wrap: true, maxWidthChars: 36 });
  subtitle.add_css_class('dim-label');
  subtitle.add_css_class('caption');
  const texts = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true });
  texts.append(heading);
  texts.append(subtitle);
  const spinner = new Gtk.Spinner({ visible: false });
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER });
  button.connect('clicked', onCheck);
  const actions = new Gtk.Box({ spacing: 12, halign: Gtk.Align.END, valign: Gtk.Align.CENTER });
  actions.append(spinner);
  actions.append(button);
  const message = new Gtk.Box({ spacing: 12, hexpand: true });
  message.append(icon);
  message.append(texts);
  // On a narrow window the button wraps below the text and the sentence keeps the full width.
  const wrap = new Adw.WrapBox({ childSpacing: 12, lineSpacing: 12, naturalLineLength: 0 });
  wrap.append(message);
  wrap.append(actions);
  wrap.set_margin_top(12);
  wrap.set_margin_bottom(12);
  wrap.set_margin_start(12);
  wrap.set_margin_end(12);
  const row = new Gtk.ListBoxRow({ activatable: false, selectable: false, child: wrap });
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  list.add_css_class('boxed-list');
  list.append(row);
  return {
    widget: list,
    show(view) {
      heading.set_label(view.title);
      subtitle.set_label(view.subtitle);
      subtitle.set_visible(view.subtitle !== '');
      button.set_label(view.button);
      button.set_sensitive(!view.busy);
      spinner.set_visible(view.busy);
      spinner.set_spinning(view.busy);
      icon.set_visible(view.icon !== null);
      if (view.icon) icon.set_from_icon_name(view.icon);
    },
  };
}
