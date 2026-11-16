/*
 * The fictional browser's chrome, and what every composed picture does before it may be captured.
 *
 * The chrome is built HERE and nowhere else, although two templates use it. It is the part that
 * has to stay auditable as "no real product's chrome, logo, name or vendor mark" (plan § Decided
 * 2026-11-16, item 6), and a second copy of the markup is a second place that claim has to be
 * re-checked. The only mark in it is Beifahrer's own icon, which has to be recognisable.
 *
 * `document.documentElement.dataset.ready` is the composer's only signal (tools/compose-shots.mjs
 * polls it). A fixed sleep instead would be a race with font loading and image decoding, and the
 * picture that lost that race would differ from the one that won it — which is exactly the
 * reproducibility this is supposed to have.
 */

/** Stroke glyphs every desktop browser has had for twenty years, drawn plainly. No vendor's set. */
const GLYPH = {
  back: 'M12.5 4.5 6 10l6.5 5.5',
  forward: 'M7.5 4.5 14 10l-6.5 5.5',
  reload: 'M15.5 10a5.5 5.5 0 1 1-1.9-4.2M15 2.5V6h-3.5',
  plus: 'M10 5.5v9M5.5 10h9',
  menu: 'M4 6h12M4 10h12M4 14h12',
};

/**
 * Beifahrer's toolbar button, as a browser really paints it: the BUILT icon out of
 * `extension/.output/`, not the colourful app icon from `data/icons/`. Those are two different
 * marks — the app icon is the bus in full colour, the toolbar look is monochrome ink with the
 * green connected dot already drawn into it (extension/scripts/icon-looks.ts, LOOK.idle). A
 * picture of the extension in a toolbar has to show the one the toolbar gets, and these PNGs are
 * literally the bytes it is handed. `-light-` is the ink for a dark chrome, so B5's dark variants
 * pick it up by scheme; `48` at a 24 px box is one image pixel per device pixel at scale 2.
 *
 * The composer lists this file under `needs`, so a missing extension build fails with a sentence
 * saying so rather than a picture with a hole in it.
 */
const TOOLBAR_ICON = {
  light: '/extension/.output/chrome-mv3/icons/idle-48.png',
  dark: '/extension/.output/chrome-mv3/icons/idle-light-48.png',
};

const icon = (name) =>
  `<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">` +
  `<path d="${GLYPH[name]}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * One tab with a neutral placeholder favicon, three neutral window discs, a back/forward/reload
 * row, an address pill on the synthetic `example.org` (RFC 2606 — the repository's rule that
 * fixtures stay synthetic holds for a picture too), Beifahrer's toolbar button, a menu.
 *
 * Nothing else: no profile avatar, no account, no sync, no bookmarks bar, no vendor glyph, no
 * product name. What a person should recognise here is "a browser", not "their browser".
 */
function renderChrome(host, scheme) {
  host.innerHTML =
    `<div class="tabstrip">` +
    `<div class="tab"><span class="favicon"></span><span data-s="tabTitle"></span></div>` +
    `<div class="newtab">${icon('plus')}</div>` +
    `<div class="wincontrols"><i></i><i></i><i></i></div>` +
    `</div>` +
    `<div class="toolbar">` +
    icon('back') +
    icon('forward') +
    icon('reload') +
    `<div class="address"><span class="scheme">https://</span><span class="host" data-s="host"></span></div>` +
    `<span class="ext"><img src="${TOOLBAR_ICON[scheme]}" alt=""></span>` +
    icon('menu') +
    `</div>`;
}

/**
 * Every word in a composed picture, from one JSON per language. A string that is missing in a
 * language is left EMPTY rather than falling back to English: a gap in the picture is visible and
 * gets fixed, whereas an English sentence in the German hero is a bug that ships looking fine.
 */
async function fillStrings(lang) {
  const strings = await fetch(`/tools/compose/strings.${lang}.json`).then((r) => r.json());
  for (const el of document.querySelectorAll('[data-s]')) el.textContent = strings[el.dataset.s] ?? '';
}

/**
 * The real captures a template shows, picked for the variant being composed: `data-shot="options"`
 * in the German dark hero becomes `/docs/images/options-de-dark.png`.
 *
 * The template therefore names WHICH capture it shows, never which file — eight variants out of one
 * template, and the German hero cannot quietly keep the English page inside its frame because the
 * `src` was copied along with the markup.
 */
function fillShots(lang, scheme) {
  for (const img of document.querySelectorAll('img[data-shot]'))
    img.src = `/docs/images/${img.dataset.shot}${lang === 'en' ? '' : `-${lang}`}-${scheme}.png`;
}

async function ready() {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') ?? 'en';
  // The scheme is told to the page, never asked of the renderer: `prefers-color-scheme` answers
  // from the machine the run happens on, which is the one input a reproducible picture may not have.
  const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.scheme = scheme;
  document.documentElement.lang = lang;
  for (const host of document.querySelectorAll('[data-chrome]')) renderChrome(host, scheme);
  fillShots(lang, scheme);
  await fillStrings(lang);
  await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  await document.fonts.ready;
  // Two frames, so everything above has been through layout and paint before the shot.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.documentElement.dataset.ready = '1';
}

ready();
