/**
 * Pages a browser keeps away from EVERY extension, whatever the person allows.
 *
 * Firefox lists them in `extensions.webextensions.restrictedDomains`, Chromium hard-codes the
 * extension stores. On such a page the host permission is refused ("Missing host permission for the
 * tab") even though the person set a level and `permissions.request` said yes, so a level there is
 * a promise nobody can keep. Knowing the list lets the popup say so instead of offering the level,
 * and lets `access_check` stop an agent before it spends a call.
 *
 * One list, here: the policy (`accessFor`), the popup, the options page and the page-call error
 * mapping all read it, so they cannot disagree about which page is closed.
 */
import type { BrowserFamily } from './protocol.ts';

/**
 * Firefox's default of `extensions.webextensions.restrictedDomains`. Firefox compares the page's
 * exact hostname with these entries, so a subdomain of one is NOT restricted (and an entry is not
 * a suffix). The person may edit the pref; this is the default every profile starts with.
 */
export const FIREFOX_RESTRICTED_HOSTS: readonly string[] = [
  'accounts-static.cdn.mozilla.net',
  'accounts.firefox.com',
  'addons.cdn.mozilla.net',
  'addons.mozilla.org',
  'api.accounts.firefox.com',
  'content.cdn.mozilla.net',
  'discovery.addons.mozilla.org',
  'install.mozilla.org',
  'oauth.accounts.firefox.com',
  'profile.accounts.firefox.com',
  'support.mozilla.org',
  'sync.services.mozilla.com',
];

/**
 * Chromium's extension stores. Chrome closes `chromewebstore.google.com` and the `/webstore` path
 * of `chrome.google.com`; Edge closes the `/addons` path of `microsoftedge.microsoft.com`. One
 * build runs on every Chromium (browser-family.ts), so the family answers for all of them: on
 * Chrome the Edge store is merely a refusal that was not needed, which is the safe side.
 */
const CHROMIUM_RESTRICTED: readonly { host: string; path?: string }[] = [
  { host: 'chromewebstore.google.com' },
  { host: 'chrome.google.com', path: '/webstore' },
  { host: 'microsoftedge.microsoft.com', path: '/addons' },
];

/** `/webstore` and `/webstore/x` are inside it; `/webstorefront` is not. */
const underPath = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Whether `family` refuses every extension on `url`. Only http(s) URLs can be restricted here;
 * anything else has no origin the policy talks about anyway. Families that restrict nothing we
 * know of (Epiphany, Safari, unknown) answer false: no list is better than a guessed one.
 */
export function isRestrictedUrl(family: BrowserFamily | undefined, url: string | null | undefined): boolean {
  if (!family || !url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // A trailing dot names the same host; treat it as the same, so it cannot be a way around.
  const host = parsed.hostname.replace(/\.$/, '');
  if (family === 'firefox') return FIREFOX_RESTRICTED_HOSTS.includes(host);
  if (family === 'chromium')
    return CHROMIUM_RESTRICTED.some(
      (r) => r.host === host && (!r.path || underPath(parsed.pathname, r.path)),
    );
  return false;
}
