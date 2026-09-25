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

  // `blob:`, `data:` and `file:` have no origin worth comparing; a download is for what the site
  // serves over the web, not for whatever a page can conjure locally.
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
