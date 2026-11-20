/**
 * The public pages on jumplink.eu the extension links to. The site exists in English and German
 * only, so every other browser language lands on the English page.
 */

export const SITE_BASE = 'https://jumplink.eu/beifahrer';

export function siteLanguage(uiLanguage: string): 'de' | 'en' {
  return uiLanguage.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * A page of the site in the browser's language; `path` is relative to the language root. The
 * root itself is the app's page with its downloads, which is where someone without the app goes.
 */
export function siteUrl(uiLanguage: string, path = ''): string {
  return `${SITE_BASE}/${siteLanguage(uiLanguage)}/${path}`;
}
