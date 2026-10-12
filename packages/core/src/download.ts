/**
 * The two judgements a download rests on, kept pure so they can be tested without a browser.
 *
 * A download is the one place where a string the agent supplied turns into a request, and the one
 * place where a string the SITE supplied turns into a file name. Both are bounded here rather
 * than at the call site, so neither bound can be forgotten by the next caller.
 */

export type DownloadTarget =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-target' | 'not-a-url' | 'not-web' | 'cross-origin'; message: string };

/**
 * What a download may fetch: the page the person already opened, and nothing past it.
 *
 * Same origin as the tab, http(s) only. A link the agent read from the page and a URL it made up
 * both come through here, because from the browser's side they are the same string.
 */
export function resolveDownloadTarget(target: string | null | undefined, pageUrl: string): DownloadTarget {
  if (!target) return { ok: false, reason: 'no-target', message: 'give either a ref or a url' };

  let page: URL;
  let wanted: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return { ok: false, reason: 'not-a-url', message: 'the tab has no address to compare against' };
  }
  try {
    wanted = new URL(target, pageUrl);
  } catch {
    return { ok: false, reason: 'not-a-url', message: `not a URL: ${target}` };
  }

  // A `blob:` URL names the origin that made it, and one the TAB's own origin made is page content,
  // not a way to reach anywhere new (ADR 0018: a button that hands the document over as a blob).
  // `data:` and `file:` have no origin worth comparing; a download is for what the site serves, not
  // for whatever a page can conjure locally.
  if (wanted.protocol === 'blob:') {
    const inner = blobOrigin(wanted.href);
    if (inner && inner === page.origin) return { ok: true, url: wanted.href };
    return {
      ok: false,
      reason: 'cross-origin',
      message: `that blob belongs to ${inner ?? 'another page'}, not this tab`,
    };
  }
  if (wanted.protocol !== 'http:' && wanted.protocol !== 'https:') {
    return { ok: false, reason: 'not-web', message: `${wanted.protocol} is not a web address` };
  }
  if (wanted.origin !== page.origin) {
    return {
      ok: false,
      reason: 'cross-origin',
      message: `that link is on ${wanted.origin}, the tab is on ${page.origin} — open it there first`,
    };
  }
  return { ok: true, url: wanted.href };
}

/**
 * What to call the file. The SITE controls `Content-Disposition`, so the result is a bare name and
 * never a path: a separator would write outside the directory it lands in, and a leading dot would
 * hide it. Falls back to the last path segment, then to `document`.
 */
export function downloadFilename(contentDisposition: string | null | undefined, url: string): string {
  const cd = contentDisposition ?? '';
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);

  let name = '';
  if (star) {
    try {
      name = decodeURIComponent(star[1]);
    } catch {
      name = star[1];
    }
  } else if (plain) {
    name = plain[1];
  } else {
    try {
      name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    } catch {
      name = '';
    }
  }

  // The site controls this string. Take the LAST segment of whatever it sent, the way a browser
  // does: `../../etc/passwd` is the name `passwd`, not a walk up the tree. Then drop leading dots,
  // so it cannot come back as a hidden file either.
  const segment = name.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return segment.replace(/^\.+/, '').trim() || 'document';
}

/** The origin a `blob:` URL was made by, or null when it does not name an http(s) one. */
export function blobOrigin(url: string): string | null {
  if (!url.toLowerCase().startsWith('blob:')) return null;
  try {
    const inner = new URL(url.slice('blob:'.length));
    return inner.protocol === 'http:' || inner.protocol === 'https:' ? inner.origin : null;
  } catch {
    return null;
  }
}

/** Public suffixes with two labels that matter for the sites this is used on. Anything not
 *  listed counts as one label, which only ever makes two hosts LESS related, never more. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'co.za',
  'com.br',
  'com.tr',
]);

/**
 * The registrable domain of a host (`app-api.meine.aok.de` → `aok.de`), or null for an IP address,
 * a single-label host or a host that is itself a public suffix. No public-suffix list is bundled:
 * the short table above is conservative, and a wrong guess can only refuse a sister, never admit a
 * stranger.
 */
export function registrableDomain(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || h.includes(':') || /^\d+(\.\d+){3}$/.test(h)) return null;
  const labels = h.split('.');
  if (labels.length < 2 || labels.some((l) => !l)) return null;
  const last2 = labels.slice(-2).join('.');
  if (TWO_LABEL_SUFFIXES.has(last2)) return labels.length >= 3 ? labels.slice(-3).join('.') : null;
  return last2;
}

export type CapturedTarget =
  | { ok: true; kind: 'blob' | 'same-origin' | 'sister'; url: string; origin: string }
  | { ok: false; reason: 'not-web' | 'other-site' | 'insecure'; message: string };

/**
 * Whether what the PAGE ITSELF opened after a click may be fetched (ADR 0018).
 *
 * Three answers, and nothing else: a blob the tab's own origin made, a URL on the tab's own origin,
 * or a URL on a SISTER origin — https, default port, same registrable domain, which is how a portal
 * at `meine.aok.de` keeps its documents at `app-api.meine.aok.de`. The caller still applies the
 * per-site level to the sister's origin before it touches it; this function only says whether the
 * two belong together. Another site, another scheme or a bare IP is refused.
 */
export function judgeCapture(captured: string, tabUrl: string): CapturedTarget {
  let tab: URL;
  let url: URL;
  try {
    tab = new URL(tabUrl);
    url = new URL(captured);
  } catch {
    return { ok: false, reason: 'not-web', message: 'not a web address' };
  }
  if (tab.protocol !== 'http:' && tab.protocol !== 'https:')
    return { ok: false, reason: 'not-web', message: 'the tab is not a web page' };

  if (url.protocol === 'blob:') {
    const origin = blobOrigin(url.href);
    return origin === tab.origin
      ? { ok: true, kind: 'blob', url: url.href, origin }
      : { ok: false, reason: 'other-site', message: 'the blob was made by another origin' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'not-web', message: `${url.protocol} is not a web address` };
  if (url.origin === tab.origin) return { ok: true, kind: 'same-origin', url: url.href, origin: url.origin };

  const mine = registrableDomain(tab.hostname);
  const theirs = registrableDomain(url.hostname);
  if (!mine || mine !== theirs)
    return { ok: false, reason: 'other-site', message: `${url.origin} is not a sister of ${tab.origin}` };
  if (url.protocol !== 'https:' || url.port !== '')
    return { ok: false, reason: 'insecure', message: 'a sister origin must be https on its default port' };
  return { ok: true, kind: 'sister', url: url.href, origin: url.origin };
}

/**
 * What `page.capture` tells the agent when the click opened a page it may not follow.
 *
 * A `file:` address is a different story from a stranger's website: it means the browser SAVED the
 * document itself (a script-made anchor with `download` or a blob save is not something capture
 * sees, ADR 0019) and then opened the copy from disk. Calling that "not a web address" sent the
 * person looking for a bug in the policy. The file is NOT read — a local path is outside every
 * origin — and the message says that the click already happened, because on a portal that marks a
 * document as read it cannot be taken back. Only the origin of a web address is named: the rest
 * may hold a one-time ticket.
 */
export function refusedOpenMessage(opened: string, reason: string, tabId: number): string {
  let url: URL | undefined;
  try {
    url = new URL(opened);
  } catch {
    // An unparseable address falls through to the generic wording.
  }
  if (url?.protocol === 'file:') {
    return (
      'the browser saved the document into its own downloads folder and opened that copy from disk ' +
      `(tab ${tabId}, a file: address). Capture only takes what the page hands to a link it can see; ` +
      'a download the page starts out of sight is saved by the browser itself, and a local file is ' +
      "outside every site's origin, so it was not read. The click already ran: do not repeat it " +
      'expecting a different result. The tab was left open.'
    );
  }
  const where = url && (url.protocol === 'http:' || url.protocol === 'https:') ? url.origin : undefined;
  return (
    `the click opened a page on ${where ?? 'an address that is not on the web'}, which a download ` +
    `may not follow (${reason}). The tab ${tabId} was left open.`
  );
}
