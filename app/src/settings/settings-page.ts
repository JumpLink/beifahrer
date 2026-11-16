/**
 * The Settings dialog (ADR 0017 § 8): what the bridge side decides, in an `Adw.PreferencesDialog`.
 * Widgets only; the rules are in `settings-model.ts`. Every change is stored at once, as GNOME
 * settings do, and nothing here touches the browser's policy: no pause, no feature, no site level.
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { DEFAULT_PORT, DEFAULT_PORT_COUNT, MAX_PORT_COUNT } from '@beifahrer/core';

import type { Translate } from '../window/i18n.ts';
import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  MAX_PORT,
  MIN_PORT,
  withPort,
  withPortCount,
  type Language,
  type Settings,
} from './settings-model.ts';

export interface SettingsDialogOptions {
  settings: Settings;
  /** Stores the settings; false when the file could not be written. */
  save(next: Settings): boolean;
  /** `BEIFAHRER_PORT*` is set in the environment and beats the file. */
  envOverride: boolean;
  /** The autostart group, where the system has one. */
  autostart: Adw.PreferencesGroup | null;
}

export function showSettings(parent: Gtk.Window, t: Translate, o: SettingsDialogOptions): void {
  let current = o.settings;
  const dialog = new Adw.PreferencesDialog({ title: t('menu.preferences') });
  const page = new Adw.PreferencesPage();

  const port = new Adw.SpinRow({
    title: t('settings.port.title'),
    subtitle: t('settings.port.subtitle'),
    adjustment: new Gtk.Adjustment({ lower: MIN_PORT, upper: MAX_PORT, stepIncrement: 1, pageIncrement: 10 }),
  });
  const count = new Adw.SpinRow({
    title: t('settings.count.title'),
    subtitle: t('settings.count.subtitle'),
    adjustment: new Gtk.Adjustment({ lower: 1, upper: MAX_PORT_COUNT, stepIncrement: 1, pageIncrement: 5 }),
  });
  const reset = new Adw.ButtonRow({ title: t('settings.ports.reset') });
  const ports = new Adw.PreferencesGroup({
    title: t('settings.ports.title'),
    description: o.envOverride ? t('settings.ports.env') : t('settings.ports.description'),
  });
  ports.add(port);
  ports.add(count);
  ports.add(reset);

  const write = new Adw.SwitchRow({
    title: t('settings.write.title'),
    subtitle: t('settings.write.subtitle'),
  });
  const agent = new Adw.PreferencesGroup({ title: t('settings.agent.title') });
  agent.add(write);

  const language = new Adw.ComboRow({
    title: t('settings.language.title'),
    subtitle: t('settings.language.subtitle'),
    model: Gtk.StringList.new([t('settings.language.system'), 'English', 'Deutsch']),
  });
  const lang = new Adw.PreferencesGroup();
  lang.add(language);

  let syncing = false;
  const show = () => {
    syncing = true;
    port.set_value(current.port ?? DEFAULT_PORT);
    count.set_value(current.portCount ?? DEFAULT_PORT_COUNT);
    write.set_active(current.allowWrite);
    language.set_selected(LANGUAGES.indexOf(current.language));
    syncing = false;
  };
  const apply = (next: Settings) => {
    if (syncing) return;
    current = next;
    if (!o.save(next)) dialog.add_toast(new Adw.Toast({ title: t('settings.failed') }));
    show();
  };
  port.connect('notify::value', () => apply(withPort(current, port.get_value())));
  count.connect('notify::value', () => apply(withPortCount(current, count.get_value())));
  write.connect('notify::active', () => apply({ ...current, allowWrite: write.get_active() }));
  language.connect('notify::selected', () =>
    apply({ ...current, language: (LANGUAGES[language.get_selected()] ?? 'system') as Language }),
  );
  reset.connect('activated', () => {
    apply({ ...current, port: DEFAULT_SETTINGS.port, portCount: DEFAULT_SETTINGS.portCount });
  });

  page.add(ports);
  page.add(agent);
  page.add(lang);
  if (o.autostart) page.add(o.autostart);
  dialog.add(page);
  show();
  dialog.present(parent);
}
