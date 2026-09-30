import { describe, expect, it } from '@gjsify/unit';
import {
  MAX_NETWORK_LIMIT,
  MAX_NETWORK_URL,
  networkRow,
  parseNetwork,
  redactUrl,
  selectRows,
  type NetworkRow,
} from '@beifahrer/core';

// `page_network` (issue #35) is what an agent has instead of a page's console, which no extension can
// read. Two things are worth pinning here, and the first one is the whole privacy argument: the
// query never enters a row. `?token=`, `?access_token=`, `?SAMLRequest=` are ordinary, a request log
// is the ideal place to leak one, and the person cannot review an argument the agent chose — so there
// is no per-call opt-out, and the redaction happens where the row is BUILT.
export default async () => {
  await describe('redactUrl', async () => {
    await it('drops the query and the fragment, and keeps the path', async () => {
      expect(redactUrl('https://example.org/api/v1/tickets?token=secret#frag')).toBe(
        'https://example.org/api/v1/tickets',
      );
      expect(redactUrl('https://example.org/a?b=1')).toBe('https://example.org/a');
      expect(redactUrl('https://example.org/a#b?c')).toBe('https://example.org/a');
      expect(redactUrl('https://example.org/plain')).toBe('https://example.org/plain');
    });

    await it('refuses a URL that is not http(s), rather than passing its bytes on', async () => {
      // A `data:` URL is the content of something else, megabytes long, with no host to gate on.
      expect(redactUrl('data:text/html;base64,PGgxPkhpPC9oMT4=')).toBe('');
      expect(redactUrl('blob:https://example.org/9f8a-1')).toBe('');
      expect(redactUrl('about:blank')).toBe('');
      expect(redactUrl('file:///etc/passwd')).toBe('');
      expect(redactUrl('')).toBe('');
    });

    await it('cuts a very long URL instead of carrying megabytes into an answer', async () => {
      const long = `https://example.org/${'a'.repeat(MAX_NETWORK_URL * 2)}`;
      const cut = redactUrl(long);
      expect(cut.length).toBe(MAX_NETWORK_URL);
      expect(cut.endsWith('…')).toBe(true);
    });
  });

  await describe('networkRow', async () => {
    const facts = {
      requestId: '1',
      tabId: 7,
      method: 'post',
      url: 'https://example.org/submit?token=secret',
      type: 'xmlhttprequest',
      at: 1_700_000_000_000,
    };

    await it('builds a pending row from a request going out', async () => {
      expect(networkRow(facts, 0, true)).toStrictEqual({
        at: 1_700_000_000_000,
        method: 'POST',
        url: 'https://example.org/submit',
        type: 'xmlhttprequest',
        frame: 0,
        pending: true,
      });
    });

    await it("carries the status and the browser's own error, and nothing it does not have", async () => {
      expect(networkRow({ ...facts, statusCode: 500 }, 0, false)).toMatchObject({
        status: 500,
        pending: false,
      });
      expect(networkRow({ ...facts, error: 'net::ERR_BLOCKED_BY_CLIENT' }, 2, false)).toMatchObject({
        error: 'net::ERR_BLOCKED_BY_CLIENT',
        frame: 2,
        pending: false,
      });
      // No status and no error is not an invented status: the key is simply absent, and the caller
      // can tell "the browser said nothing" from "the browser said 0".
      expect('status' in (networkRow(facts, 0, false) ?? {})).toBe(false);
    });

    await it('refuses a request that is not one an agent may hear', async () => {
      expect(networkRow({ ...facts, url: 'data:text/html,x' }, 0, true)).toBe(null);
      expect(networkRow({ ...facts, url: '' }, 0, true)).toBe(null);
    });

    await it("uses the time the caller measured, not the browser's own", async () => {
      // Firefox has been seen reporting `timeStamp` in seconds, and a log whose order is wrong is
      // worse than no log — so the row takes the extension's clock and ignores the field entirely.
      expect(networkRow({ ...facts, at: 0, timeStamp: 1_700_000_000 }, 0, true)?.at).toBeGreaterThan(0);
    });
  });

  await describe('parseNetwork', async () => {
    await it('takes a limit and a since, and bounds them', async () => {
      expect(parseNetwork({})).toStrictEqual({ limit: 50, since: 0 });
      expect(parseNetwork({ limit: 10, since: 5 })).toStrictEqual({ limit: 10, since: 5 });
      expect(parseNetwork({ limit: 10_000 })).toStrictEqual({ limit: MAX_NETWORK_LIMIT, since: 0 });
    });

    await it('refuses a limit of nothing, and a time before the epoch', async () => {
      expect(typeof parseNetwork({ limit: 0 })).toBe('string');
      expect(typeof parseNetwork({ limit: -1 })).toBe('string');
      expect(typeof parseNetwork({ since: -1 })).toBe('string');
      expect(typeof parseNetwork({ since: 'now' })).toBe('string');
    });

    await it('refuses an unknown key instead of dropping it', async () => {
      // Dropping `includeQuery` would answer a different question than the one asked, and the caller
      // would believe it had asked for the query.
      expect(parseNetwork({ includeQuery: true })).toBe('unknown key "includeQuery"');
      expect(parseNetwork('x')).toBe('params must be an object');
    });
  });

  await describe('selectRows', async () => {
    const row = (at: number, url: string): NetworkRow => ({
      at,
      method: 'GET',
      url,
      frame: 0,
      pending: false,
    });
    const rows = [row(1, 'https://a/1'), row(2, 'https://a/2'), row(3, 'https://a/3')];

    await it('reads from the end: a log is read backwards, and limit counts from there', async () => {
      expect(selectRows(rows, { limit: 2, since: 0 }).map((r) => r.url)).toStrictEqual([
        'https://a/3',
        'https://a/2',
      ]);
    });

    await it('takes only what is newer than since', async () => {
      expect(selectRows(rows, { limit: 10, since: 1 }).map((r) => r.at)).toStrictEqual([3, 2]);
      expect(selectRows(rows, { limit: 10, since: 3 })).toStrictEqual([]);
    });
  });
};
