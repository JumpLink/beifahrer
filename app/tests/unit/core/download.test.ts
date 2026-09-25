import { describe, expect, it } from '@gjsify/unit';

import { downloadFilename, resolveDownloadTarget } from '@beifahrer/core';

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
