/**
 * The two places the person decides about autostart (ADR 0024 § 4): the question after the first
 * pairing and the switch in Preferences. Widgets only; the rules are in `autostart-model.ts`.
 */

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

import type { Translate } from './i18n.ts';

/** The plain question; resolves `true` for "Start at login", `false` for "No, thanks" or a dismissal. */
export function askAutostart(parent: Gtk.Window, t: Translate): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = new Adw.AlertDialog({ heading: t('autostart.title'), body: t('autostart.body') });
    dialog.add_response('no', t('autostart.no'));
    dialog.add_response('yes', t('autostart.yes'));
    dialog.set_response_appearance('yes', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('yes');
    dialog.set_close_response('no');
    dialog.connect('response', (_dialog, response) => resolve(response === 'yes'));
    dialog.present(parent);
  });
}

/**
 * Preferences with the one switch. `change` runs the portal and resolves whether the new value is in
 * force; when it is not, the switch springs back and the person is told.
 */
export function showPreferences(
  parent: Gtk.Window,
  t: Translate,
  enabled: boolean,
  change: (on: boolean) => Promise<boolean>,
  toast: (title: string) => void,
): void {
  const row = new Adw.SwitchRow({
    title: t('autostart.row.title'),
    subtitle: t('autostart.row.subtitle'),
    active: enabled,
  });
  let busy = false;
  row.connect('notify::active', () => {
    if (busy) return;
    const on = row.get_active();
    busy = true;
    change(on)
      .then((ok) => {
        if (ok) return;
        row.set_active(!on);
        toast(t('autostart.failed'));
      })
      .catch(() => {
        row.set_active(!on);
        toast(t('autostart.failed'));
      })
      .finally(() => {
        busy = false;
      });
  });
  const group = new Adw.PreferencesGroup({ title: t('autostart.group') });
  group.add(row);
  const page = new Adw.PreferencesPage();
  page.add(group);
  const dialog = new Adw.PreferencesDialog({ title: t('menu.preferences') });
  dialog.add(page);
  dialog.present(parent);
}
