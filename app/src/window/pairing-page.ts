/**
 * The Browser page: the pairing token to copy, where it is stored, and the warning when a second token
 * file would pair the browsers differently. A view and a clipboard: it does not rotate the token and
 * it does not write anywhere (ADR 0017).
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import type { BrowserRow } from './browser-model.ts';
import { copyText } from './clipboard.ts';
import type { Translate } from './i18n.ts';
import type { PairingView } from './pairing-model.ts';
import { clamped } from './window.ts';

export interface PairingPage {
  widget: Gtk.Widget;
  show(view: PairingView): void;
  showBrowsers(rows: readonly BrowserRow[]): void;
  copyToken(): boolean;
}

export function createPairingPage(t: Translate, toast: (title: string) => void): PairingPage {
  const group = new Adw.PreferencesGroup({
    title: t('pairing.title'),
    description: t('pairing.description'),
  });
  const tokenRow = new Adw.PasswordEntryRow({ title: t('pairing.token') });
  tokenRow.set_editable(false);
  const copy = Gtk.Button.new_from_icon_name('edit-copy-symbolic');
  copy.add_css_class('flat');
  copy.set_valign(Gtk.Align.CENTER);
  copy.set_tooltip_text(t('pairing.copy'));
  tokenRow.add_suffix(copy);
  const pathRow = new Adw.ActionRow({ title: t('pairing.path'), subtitleSelectable: true });
  group.add(tokenRow);
  group.add(pathRow);

  const browsers = new Adw.PreferencesGroup({
    title: t('browser.list.title'),
    description: t('browser.list.description'),
    visible: false,
  });
  const warnings = new Adw.PreferencesGroup();
  const error = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  error.add_css_class('error');

  const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24 });
  column.append(browsers);
  column.append(group);
  column.append(warnings);
  column.append(error);

  let token: string | null = null;
  /** Put the token on the clipboard as plain text. False when there is nothing to copy or no clipboard. */
  const copyToken = (): boolean => {
    if (token === null || !copyText(token)) return false;
    toast(t('pairing.copied'));
    return true;
  };
  copy.connect('clicked', copyToken);

  let rows: Adw.ActionRow[] = [];
  let browserWidgets: Adw.ActionRow[] = [];
  return {
    widget: clamped(column),
    copyToken,
    showBrowsers(list) {
      for (const row of browserWidgets) browsers.remove(row);
      browserWidgets = list.map((b) => {
        const row = new Adw.ActionRow({
          title: b.isDefault ? t('setup.browser.default', { name: b.name }) : b.name,
          subtitle: t(`browser.state.${b.state}`),
        });
        // Only the good news gets a mark (ADR 0009): an "x" there reads as a close button, and the
        // subtitle already says what is missing.
        if (b.state === 'connected') {
          const badge = new Gtk.Image({ iconName: 'object-select-symbolic', valign: Gtk.Align.CENTER });
          badge.add_css_class('success');
          row.add_suffix(badge);
        }
        return row;
      });
      for (const row of browserWidgets) browsers.add(row);
      browsers.set_visible(browserWidgets.length > 0);
    },
    show(view) {
      token = view.token;
      group.set_visible(view.token !== null);
      // Only when it changed: setting the text of a row the person is looking at resets its reveal state.
      if (view.token !== null && tokenRow.get_text() !== view.token) tokenRow.set_text(view.token);
      pathRow.set_subtitle(view.path ?? '');
      for (const row of rows) warnings.remove(row);
      rows = view.warnings.map((w) => {
        const row = new Adw.ActionRow({ title: w.title, subtitle: w.description });
        row.add_prefix(new Gtk.Image({ iconName: 'dialog-warning-symbolic' }));
        return row;
      });
      for (const row of rows) warnings.add(row);
      warnings.set_visible(rows.length > 0);
      error.set_label(view.error ?? '');
      error.set_visible(view.error !== null);
    },
  };
}
