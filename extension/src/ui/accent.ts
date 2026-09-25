/**
 * Every extension page follows the desktop's accent colour (../accent.ts): through adwaita-web's
 * own `applyAdwaitaAccent` for one of libadwaita's nine accents, which resolves light or dark
 * from the page itself, and through the local `AccentColor` shim otherwise.
 */

import { ACCENT_BG_PROPERTY, ACCENT_PROPERTY, applyAdwaitaAccent, isAdwaitaDark } from '@gjsify/adwaita-web';
import { accentColors, followAccent } from '../accent.ts';

followAccent((choice) => {
  const root = document.documentElement;
  if (choice.from !== 'system') {
    applyAdwaitaAccent(choice.name);
    return;
  }
  const { bg, fg } = accentColors(choice, isAdwaitaDark(root));
  root.style.setProperty(ACCENT_BG_PROPERTY, bg);
  root.style.setProperty(ACCENT_PROPERTY, fg);
});
