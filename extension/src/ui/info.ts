/**
 * The info affordance: an explanation the person may want once, kept out of the page until
 * asked for. A flat circular info button in a group's header, opening a popover with one line
 * (the GNOME pattern for help that is not needed every time).
 */

import type { Gtk } from '@gjsify/adwaita-web';
import { t, type MessageKey } from '../i18n.ts';

export function infoButton(text: MessageKey): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'info';
  wrap.slot = 'header-suffix';
  const button = document.createElement('gtk-button') as Gtk.Button;
  button.setAttribute('icon-name', 'help-about-symbolic');
  // An icon-only button takes its accessible name from the tooltip.
  button.setAttribute('tooltip-text', t('action_info'));
  button.toggleAttribute('flat', true);
  button.toggleAttribute('circular', true);
  const popover = document.createElement('gtk-popover') as HTMLElement & { open: boolean };
  popover.setAttribute('align', 'end');
  // gjsify gap (unfixed, @gjsify/adwaita-web 0.52.0): <gtk-popover> knows only the roles `menu`
  // and `listbox`, but this one holds a sentence, not items. It keeps an attribute it does not
  // know, so the surface is announced as what it is.
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', t('action_info'));
  const line = document.createElement('p');
  line.className = 'info-text';
  line.textContent = t(text);
  popover.append(line);
  button.addEventListener('click', () => {
    popover.open = !popover.open;
  });
  wrap.append(button, popover);
  return wrap;
}
