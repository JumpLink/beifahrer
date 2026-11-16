/**
 * The About dialog, opened from the header bar's menu (`app.about`).
 *
 * The link is labelled "Support", never "Donate": this is business income, and nothing here may imply
 * a tax deduction. The URL is the one in `<url type="donation">` of the metainfo.
 */

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { donationsAllowed } from '@gjsify/distribution';

import { VERSION } from '../version.ts';
import type { Locale, Translate } from './i18n.ts';

export const SUPPORT_URL = 'https://jumplink.eu/beifahrer/en/support/';
const WEBSITE = 'https://jumplink.eu/beifahrer/';
const REPOSITORY = 'https://github.com/JumpLink/beifahrer';
const DOCS = `${REPOSITORY}/tree/main/docs`;
const APP_ID = 'eu.jumplink.beifahrer';

export function installAboutAction(app: Adw.Application, t: Translate, locale: Locale): void {
  const action = new Gio.SimpleAction({ name: 'about' });
  action.connect('activate', () => {
    const dialog = new Adw.AboutDialog({
      applicationName: t('app.title'),
      applicationIcon: APP_ID,
      developerName: 'JumpLink',
      website: WEBSITE,
      issueUrl: `${REPOSITORY}/issues`,
      version: VERSION,
      licenseType: Gtk.License.AGPL_3_0,
      copyright: '© JumpLink',
    });
    if (donationsAllowed()) dialog.add_link(t('about.support'), SUPPORT_URL);
    dialog.add_link(t('about.source'), REPOSITORY);
    dialog.add_link(t('about.docs'), DOCS);
    dialog.add_link(t('about.privacy'), `${WEBSITE}${locale}/privacy/`);
    dialog.add_link(t('about.legal'), `${WEBSITE}${locale}/legal-notice/`);
    dialog.present(app.get_active_window());
  });
  app.add_action(action);
}
