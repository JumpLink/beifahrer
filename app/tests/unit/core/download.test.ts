import { describe, expect, it } from '@gjsify/unit';

import {
  downloadFilename,
  judgeCapture,
  refusedOpenMessage,
  registrableDomain,
  resolveDownloadTarget,
} from '@beifahrer/core';

// A download turns a string into an authenticated request, and a second string into a file name.
// Both strings come from somewhere untrusted — the agent, or the site — so the tests below aim at
// the direction that hurts: something reaching FURTHER than the page the person opened, or a name
// that stops being a name and becomes a path.
export default async () => {
  await describe('resolveDownloadTarget', async () => {
    const page = 'https://bank.example/portal/inbox?id=7';

    await it('resolves a relative link against the page', async () => {
      const r = resolveDownloadTarget('/portal/doc/12.pdf', page);
      expect(r.ok).toBe(true);
      expect(r.ok && r.url).toBe('https://bank.example/portal/doc/12.pdf');
    });

    await it('accepts an absolute URL on the same origin', async () => {
      const r = resolveDownloadTarget('https://bank.example/x.pdf', page);
      expect(r.ok).toBe(true);
    });

    await it('refuses another origin', async () => {
      const r = resolveDownloadTarget('https://evil.example/x.pdf', page);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe('cross-origin');
    });

    // `//host/path` inherits the scheme and looks relative at a glance. It is not.
    await it('refuses a protocol-relative URL to another host', async () => {
      const r = resolveDownloadTarget('//evil.example/x.pdf', page);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe('cross-origin');
    });

    // An origin includes the port, so a second service on the same host is a different origin.
    await it('refuses the same host on another port', async () => {
      const r = resolveDownloadTarget('https://bank.example:8443/x.pdf', page);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe('cross-origin');
    });

    await it('refuses a scheme that is not the web', async () => {
      for (const t of ['data:text/plain,hi', 'file:///etc/passwd', 'javascript:alert(1)']) {
        const r = resolveDownloadTarget(t, page);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe('not-web');
      }
    });

    await it('refuses nothing at all', async () => {
      for (const t of [undefined, null, '']) {
        const r = resolveDownloadTarget(t, page);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe('no-target');
      }
    });
  });

  await describe('resolveDownloadTarget and blobs', async () => {
    const page = 'https://portal.example/client/postbox';

    await it('accepts a blob the tab itself made', async () => {
      const r = resolveDownloadTarget('blob:https://portal.example/3f2c-aa', page);
      expect(r.ok).toBe(true);
    });
    await it("refuses another origin's blob and a blob with no origin", async () => {
      expect(resolveDownloadTarget('blob:https://evil.example/3f2c', page).ok).toBe(false);
      expect(resolveDownloadTarget('blob:null/3f2c', page).ok).toBe(false);
    });
    await it('still refuses data: and file:', async () => {
      expect(resolveDownloadTarget('data:text/plain;base64,AAAA', page).ok).toBe(false);
      expect(resolveDownloadTarget('file:///etc/passwd', page).ok).toBe(false);
    });
  });

  await describe('registrableDomain', async () => {
    await it('takes the last two labels, three under a known two-label suffix', async () => {
      expect(registrableDomain('app-api.meine.portal.example')).toBe('portal.example');
      expect(registrableDomain('www.shop.co.uk')).toBe('shop.co.uk');
    });
    await it('has none for an IP, a bare name or a public suffix', async () => {
      expect(registrableDomain('192.168.0.10')).toBeNull();
      expect(registrableDomain('localhost')).toBeNull();
      expect(registrableDomain('co.uk')).toBeNull();
      expect(registrableDomain('[::1]')).toBeNull();
    });
  });

  // ADR 0018. What the page opened by itself after a click may be fetched when it is the tab's own
  // blob, the tab's own origin, or a sister origin of the same site — and nowhere else.
  await describe('judgeCapture', async () => {
    const tab = 'https://meine.portal.example/client/postbox/inbox';

    await it("takes the tab's own blob and own origin", async () => {
      const blob = judgeCapture('blob:https://meine.portal.example/9c1e', tab);
      expect(blob.ok && blob.kind).toBe('blob');
      const same = judgeCapture('https://meine.portal.example/doc/1', tab);
      expect(same.ok && same.kind).toBe('same-origin');
    });
    await it('takes a sister origin of the same registrable domain', async () => {
      const r = judgeCapture('https://app-api.meine.portal.example/cx/attachments/1', tab);
      expect(r.ok && r.kind).toBe('sister');
      expect(r.ok && r.origin).toBe('https://app-api.meine.portal.example');
    });
    await it('refuses another site, even one that merely looks alike', async () => {
      for (const url of [
        'https://evil.example/x',
        'https://portal.example.evil.example/x',
        'https://meine-portal.example/x',
        'https://notportal.example/x',
      ]) {
        const r = judgeCapture(url, tab);
        expect(r.ok).toBe(false);
      }
    });
    await it('refuses a sister over http, on another port, or a bare IP', async () => {
      expect(judgeCapture('http://app-api.meine.portal.example/x', tab).ok).toBe(false);
      expect(judgeCapture('https://app-api.meine.portal.example:8443/x', tab).ok).toBe(false);
      expect(judgeCapture('https://10.0.0.5/x', tab).ok).toBe(false);
    });
    await it("refuses another origin's blob, data:, javascript: and file:", async () => {
      expect(judgeCapture('blob:https://evil.example/1', tab).ok).toBe(false);
      expect(judgeCapture('data:application/pdf;base64,AAAA', tab).ok).toBe(false);
      expect(judgeCapture('javascript:alert(1)', tab).ok).toBe(false);
      expect(judgeCapture('file:///etc/passwd', tab).ok).toBe(false);
    });
    await it('refuses everything when the tab is not a web page or has two hosts of one IP', async () => {
      expect(judgeCapture('https://a.example/x', 'about:blank').ok).toBe(false);
      expect(judgeCapture('https://10.0.0.5/x', 'https://10.0.0.6/').ok).toBe(false);
    });
  });

  await describe('refusedOpenMessage', async () => {
    await it('says the browser saved the file itself when the tab is a file: address', async () => {
      const m = refusedOpenMessage('file:///home/p/Downloads/statement.pdf', 'file: is not a web address', 5);
      expect(m).toMatch(/browser saved the document/);
      expect(m).toMatch(/already ran/);
      expect(m).not.toMatch(/not a web address/);
      // The path of a local file is the person's, and goes nowhere.
      expect(m).not.toMatch(/Downloads|statement/);
    });

    await it('names only the origin of a web address, never the ticket in its path', async () => {
      const m = refusedOpenMessage('https://evil.example/dl?ticket=SECRET', 'not a sister', 9);
      expect(m).toMatch(/https:\/\/evil\.example,/);
      expect(m).not.toMatch(/SECRET/);
      expect(m).toMatch(/tab 9 was left open/);
    });

    await it('falls back to a plain wording for an address that cannot be parsed', async () => {
      expect(refusedOpenMessage('::', 'not a web address', 2)).toMatch(/address that is not on the web/);
    });
  });

  await describe('downloadFilename', async () => {
    const url = 'https://bank.example/portal/doc/12.pdf';

    await it('takes the name the site suggests', async () => {
      expect(downloadFilename('attachment; filename="Kontoauszug.pdf"', url)).toBe('Kontoauszug.pdf');
    });

    await it('decodes the RFC 5987 form', async () => {
      expect(downloadFilename("attachment; filename*=UTF-8''Geb%C3%BChren.pdf", url)).toBe('Gebühren.pdf');
    });

    // The site controls this string. A separator would write outside the folder it lands in.
    await it('never lets the name become a path', async () => {
      expect(downloadFilename('attachment; filename="../../etc/passwd"', url)).toBe('passwd');
      expect(downloadFilename('attachment; filename="..\\\\..\\\\secret"', url)).toBe('secret');
      expect(downloadFilename('attachment; filename="/abs/olute"', url)).toBe('olute');
    });

    await it('never returns a hidden name', async () => {
      expect(downloadFilename('attachment; filename=".bashrc"', url)).toBe('bashrc');
    });

    await it('falls back to the last path segment, then to a default', async () => {
      expect(downloadFilename(null, url)).toBe('12.pdf');
      expect(downloadFilename(null, 'https://bank.example/portal/')).toBe('document');
      expect(downloadFilename('attachment', 'https://bank.example/')).toBe('document');
    });
  });
};
