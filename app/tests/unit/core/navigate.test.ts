import { describe, expect, it } from '@gjsify/unit';
import { MAX_NAVIGATE_MS, NAVIGATIONS, parseNavigate } from '@beifahrer/core';

// `page.navigate` moves the PERSON'S tab, and the rules that keep that from being a way around the
// per-origin level are decided here, without a browser: a URL the agent supplies is checked like
// `tabs.open`'s, and a request that names two destinations at once is refused rather than guessed.
export default async () => {
  await describe('parseNavigate', async () => {
    await it('takes a URL to go to', async () => {
      expect(parseNavigate({ navigation: 'url', url: 'https://example.org/a' })).toStrictEqual({
        navigation: 'url',
        url: 'https://example.org/a',
        timeoutMs: 10_000,
      });
    });

    await it('defaults to a URL, so the common call does not name the move', async () => {
      // An agent that says "go to this page" should not have to learn the word "url" for it.
      expect(parseNavigate({ url: 'https://example.org/' })).toStrictEqual({
        navigation: 'url',
        url: 'https://example.org/',
        timeoutMs: 10_000,
      });
    });

    await it('takes a history move with no URL at all', async () => {
      for (const navigation of ['back', 'forward', 'reload'] as const) {
        const parsed = parseNavigate({ navigation });
        expect(parsed).toStrictEqual({ navigation, timeoutMs: 10_000 });
        // A history move names no destination, and a `url` in the result would be one the caller
        // never wrote — which is exactly the kind of thing that must not slip in silently.
        expect(typeof parsed !== 'string' && 'url' in parsed).toBe(false);
      }
    });

    await it('names every move it accepts, and nothing else', async () => {
      expect([...NAVIGATIONS]).toStrictEqual(['url', 'back', 'forward', 'reload']);
      for (const navigation of ['fwd', 'reload!', 'BACK', '', 7, null]) {
        expect(typeof parseNavigate({ navigation, url: 'https://example.org/' })).toBe('string');
      }
    });

    await it('refuses a URL with a history move: two destinations, no order between them', async () => {
      // Not a warning. Guessing which of the two was meant is a guess about where a person's tab
      // goes, and the person answered for a different place than the one that would open.
      const refused = parseNavigate({ navigation: 'back', url: 'https://example.org/' }) as string;
      expect(refused).toContain('url');
    });

    await it('refuses a URL that is missing, empty or not a string', async () => {
      for (const raw of [
        { navigation: 'url' },
        { navigation: 'url', url: '' },
        { navigation: 'url', url: '   ' },
        { navigation: 'url', url: 42 },
        { navigation: 'url', url: null },
      ])
        expect(typeof parseNavigate(raw)).toBe('string');
    });

    await it('refuses an unknown key rather than dropping it', async () => {
      // Fail closed, like every other parser here: a dropped key would move the tab under a
      // destination the caller did not name. `tabId` and `browser` are the call's own addressing and
      // are stripped by the handler before this point, so what is left really is unknown.
      const refused = parseNavigate({ navigation: 'reload', world: 'main' }) as string;
      expect(refused).toContain('world');
    });

    await it('refuses a request that names no destination at all', async () => {
      // Not a silent "url" with nothing to go to: that would answer "where?" to a call that asked
      // for nothing, and a reload is one word away.
      const refused = parseNavigate({}) as string;
      expect(refused).toContain('url');
      expect(typeof parseNavigate({ navigation: 'url' })).toBe('string');
    });

    await it('refuses a URL too long to show the person', async () => {
      expect(typeof parseNavigate({ navigation: 'url', url: `https://e.org/${'x'.repeat(4_000)}` })).toBe(
        'string',
      );
      expect(typeof parseNavigate({ navigation: 'url', url: 'https://e.org/x' })).toBe('object');
    });

    await it('bounds the wait, and never below a tenth of a second', async () => {
      const slow = parseNavigate({ navigation: 'reload', timeoutMs: 600_000 }) as { timeoutMs: number };
      expect(slow.timeoutMs).toBe(MAX_NAVIGATE_MS);
      const quick = parseNavigate({ navigation: 'reload', timeoutMs: 1 }) as { timeoutMs: number };
      expect(quick.timeoutMs).toBe(100);
      // Nonsense falls back to the default rather than to zero: a zero deadline would fail every
      // navigation before the browser had committed the URL.
      const junk = parseNavigate({ navigation: 'reload', timeoutMs: 'soon' }) as { timeoutMs: number };
      expect(junk.timeoutMs).toBe(10_000);
    });

    await it('refuses what is not an object', async () => {
      for (const raw of [null, 'back', 7, [], undefined]) expect(typeof parseNavigate(raw)).toBe('string');
    });
  });
};
