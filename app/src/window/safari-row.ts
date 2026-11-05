/**
 * The Safari row (ADR 0026 § 3): read-only state, a button that opens Safari's own Settings, and a
 * short hint about pairing. No pause, no resume, no feature switch, no site level — this shows
 * Safari's own answer to "is this extension on", never Beifahrer's policy (ADR 0017 § 2). Hidden
 * entirely off macOS, or when `safariView` has not run yet.
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import type { Translate } from './i18n.ts';
import type { SafariView } from './safari-model.ts';

export interface SafariRow {
  widget: Gtk.Widget;
  show(view: SafariView): void;
}

/** `onOpenSettings` must only ever run from this button's own click (ADR 0026 § 4), never automatically. */
export function createSafariRow(t: Translate, onOpenSettings: () => void): SafariRow {
  const row = new Adw.ActionRow({ title: t('safari.title') });
  const open = Gtk.Button.new_with_label(t('safari.open'));
  open.set_valign(Gtk.Align.CENTER);
  open.connect('clicked', onOpenSettings);
  row.add_suffix(open);
  const group = new Adw.PreferencesGroup();
  group.add(row);
  const hint = new Gtk.Label({ wrap: true, xalign: 0 });
  hint.add_css_class('dim-label');
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: false });
  box.append(group);
  box.append(hint);
  return {
    widget: box,
    show(view) {
      box.set_visible(view.visible);
      if (!view.visible) return;
      row.set_subtitle(view.stateText);
      hint.set_label(view.hint);
    },
  };
}
