/**
 * Every extension page follows the desktop's accent colour (../accent.ts): through adwaita-web's
 * own `applyAdwaitaAccent` for one of libadwaita's nine accents, which resolves light or dark from
 * the page itself, and through adwaita-web's `applySystemAccent` where no bridge reported a desktop
 * accent and the browser exposes `AccentColor`.
 *
 * `applySystemAccent` snaps the resolved colour to the nearest of the nine with libadwaita's own
 * rule and writes both custom properties, so the page and the in-page pill (which keeps the keyword,
 * since it runs in the content script) agree on which accent the desktop means.
 */

import { applyAdwaitaAccent, applySystemAccent, clearAdwaitaAccent } from '@gjsify/adwaita-web';
import { followAccent } from '../accent.ts';

followAccent((choice) => {
  if (choice.from === 'system') {
    // `applyAdwaitaAccent` marks the root as the APP's own choice, and adwaita-web never writes
    // over one — so without this the first bridge-reported accent would pin the page to it for
    // good, and `system` would never take hold again.
    clearAdwaitaAccent();
    applySystemAccent();
    return;
  }
  applyAdwaitaAccent(choice.name);
});
