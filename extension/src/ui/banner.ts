/**
 * The one banner both pages show, painted from the state alone (BANNERS in status.ts).
 *
 * The popup's and the options' own "what does this state need" logic lived in each of them, which
 * is how the two drifted: one of them had a banner for a state the other had not. A page says what
 * it can do about a state through `can`, and the banner decides the rest, so the two pages cannot
 * disagree about which states speak (ADR 0014).
 */

import type { Adw } from '@gjsify/adwaita-web';
import { t, type MessageKey } from '../i18n.ts';
import { BANNERS, type Fix, type UiState } from './status.ts';

const FIX_LABEL: Record<Fix, MessageKey> = { resume: 'action_resume', settings: 'action_settings' };

/**
 * Paint the banner for `state`. `can` is what the calling page can do about the state: the options
 * page is where the token and the versions are, so it offers the resume a pause needs and no button
 * for the states it already is the answer to.
 */
export function renderBanner(banner: Adw.Banner, state: UiState, can: (fix: Fix) => boolean): void {
  const spec = BANNERS[state];
  if (spec) {
    banner.setAttribute('title', t(spec.title));
    if (can(spec.fix)) banner.setAttribute('button-label', t(FIX_LABEL[spec.fix]));
    else banner.removeAttribute('button-label');
    // The stylesheet paints the strip from this (src/ui/style.css): Adwaita's own warning or error
    // colour, which follows `prefers-color-scheme` with the rest of the page.
    banner.dataset.severity = spec.severity;
  } else {
    banner.removeAttribute('data-severity');
  }
  banner.toggleAttribute('revealed', spec !== undefined);
}
