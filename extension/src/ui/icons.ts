/**
 * The symbolic icons the pages use that `@gjsify/adwaita-web` does not compile into its
 * stylesheet. Registered by name, so `<gtk-image icon-name="…">`, `icon-name` on buttons, toggles
 * and status pages resolve them like the package's own. Named imports only: the icon set is
 * about 1 MB, and the bundler keeps just these.
 *
 * Loaded by `ui.js` only (kit.ts): the page scripts must not import this file, or each would
 * bundle `@gjsify/adwaita-web` a second time. Which icon means what is in icon-names.ts.
 */

import { registerIcon } from '@gjsify/adwaita-web';
import {
  documentOpenRecentSymbolic,
  helpAboutSymbolic,
  formatJustifyLeftSymbolic,
  insertTextSymbolic,
  mediaPlaybackPauseSymbolic,
  mediaPlaybackStartSymbolic,
  tabNewSymbolic,
} from '@gjsify/adwaita-icons/actions';
import { inputMouseSymbolic } from '@gjsify/adwaita-icons/devices';
import { utilitiesTerminalSymbolic, webBrowserSymbolic } from '@gjsify/adwaita-icons/legacy';
import { dialogPasswordSymbolic, dialogWarningSymbolic } from '@gjsify/adwaita-icons/status';

const EXTRA: Record<string, string> = {
  'dialog-password-symbolic': dialogPasswordSymbolic,
  'dialog-warning-symbolic': dialogWarningSymbolic,
  'document-open-recent-symbolic': documentOpenRecentSymbolic,
  'help-about-symbolic': helpAboutSymbolic,
  'format-justify-left-symbolic': formatJustifyLeftSymbolic,
  'input-mouse-symbolic': inputMouseSymbolic,
  'insert-text-symbolic': insertTextSymbolic,
  'media-playback-pause-symbolic': mediaPlaybackPauseSymbolic,
  'media-playback-start-symbolic': mediaPlaybackStartSymbolic,
  'tab-new-symbolic': tabNewSymbolic,
  'utilities-terminal-symbolic': utilitiesTerminalSymbolic,
  'web-browser-symbolic': webBrowserSymbolic,
};

export function registerIcons(): void {
  for (const [name, svg] of Object.entries(EXTRA)) registerIcon(name, svg);
}
