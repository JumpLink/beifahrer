import { describe, expect, it } from '@gjsify/unit';
import { EXPECT_STATES, MAX_EXPECT_MS, MAX_EXPECT_TEXT, expectationOf, parseExpect } from '@beifahrer/core';

// `page_expect` (issue #35) asserts a STATE and reports what it saw instead. Two things are worth
// pinning here, and the second is the one that matters: a request naming no target, and a request
// naming no condition, must both be REFUSED. The tempting default is `visible`, and the silent answer
// would then be `pass` about a page nobody looked at — a green result for a check that did not happen,
// which is worse than an error because nothing downstream can tell the difference.
export default async () => {
  await describe('parseExpect', async () => {
    await it('takes a ref with a condition, and no query', async () => {
      expect(parseExpect({ ref: 'e4', state: 'visible' })).toStrictEqual({
        ref: 'e4',
        state: 'visible',
        timeoutMs: 10_000,
      });
    });

    await it('takes a frame ref like any other', async () => {
      expect(parseExpect({ ref: 'b2e12', state: 'enabled' })).toStrictEqual({
        ref: 'b2e12',
        state: 'enabled',
        timeoutMs: 10_000,
      });
    });

    await it('takes a query, checked with the same parser page_find uses', async () => {
      // Not a looser second copy: `parseElementQuery` does this, and a second validator for one shape
      // is how a query starts meaning two things.
      expect(parseExpect({ query: { role: 'button', name: 'Send' }, state: 'hidden' })).toStrictEqual({
        query: { role: 'button', name: 'Send' },
        state: 'hidden',
        timeoutMs: 10_000,
      });
      expect(typeof parseExpect({ query: { role: 'nonesuch' }, state: 'hidden' })).toBe('string');
      expect(typeof parseExpect({ query: { nosuch: 1 }, state: 'hidden' })).toBe('string');
    });

    await it('refuses both a ref and a query, and neither', async () => {
      expect(typeof parseExpect({ ref: 'e1', query: { role: 'button' }, state: 'visible' })).toBe('string');
      expect(typeof parseExpect({ state: 'visible' })).toBe('string');
    });

    await it('refuses a request with nothing to check, rather than defaulting to visible', async () => {
      expect(parseExpect({ ref: 'e1' })).toBe(
        'page.expect needs a state, a value, a text or a count to check',
      );
      expect(parseExpect({ query: { role: 'button' } })).toBe(
        'page.expect needs a state, a value, a text or a count to check',
      );
    });

    await it('does not default `state` when another condition was asked for', async () => {
      // `value` alone is a complete assertion. Filling in `visible` would add a claim the agent never
      // made, and a false one on an element that is present but scrolled out of view.
      expect(parseExpect({ ref: 'e1', value: '42' })).toStrictEqual({
        ref: 'e1',
        value: '42',
        timeoutMs: 10_000,
      });
    });

    await it('accepts every state it lists, and nothing outside them', async () => {
      for (const state of EXPECT_STATES) expect(typeof parseExpect({ ref: 'e1', state })).toBe('object');
      expect(typeof parseExpect({ ref: 'e1', state: 'vibran' })).toBe('string');
      expect(typeof parseExpect({ ref: 'e1', state: 7 })).toBe('string');
    });

    await it('takes an empty text and an empty value — clearing a field is a real thing to assert', async () => {
      expect(parseExpect({ ref: 'e1', value: '' })).toStrictEqual({
        ref: 'e1',
        value: '',
        timeoutMs: 10_000,
      });
      expect(parseExpect({ query: { role: 'button' }, text: '' })).toStrictEqual({
        query: { role: 'button' },
        text: '',
        timeoutMs: 10_000,
      });
    });

    await it('takes a count of zero, because "nothing here any more" is a state worth waiting for', async () => {
      expect(parseExpect({ query: { role: 'button' }, count: 0 })).toStrictEqual({
        query: { role: 'button' },
        count: 0,
        timeoutMs: 10_000,
      });
      expect(typeof parseExpect({ query: { role: 'button' }, count: -1 })).toBe('string');
      expect(typeof parseExpect({ query: { role: 'button' }, count: 1.5 })).toBe('string');
    });

    await it('clamps the timeout at both ends', async () => {
      expect(parseExpect({ ref: 'e1', state: 'visible', timeoutMs: 0 })).toMatchObject({ timeoutMs: 100 });
      expect(parseExpect({ ref: 'e1', state: 'visible', timeoutMs: 999_999 })).toMatchObject({
        timeoutMs: MAX_EXPECT_MS,
      });
      expect(parseExpect({ ref: 'e1', state: 'visible', timeoutMs: 'soon' })).toMatchObject({
        timeoutMs: 10_000,
      });
    });

    await it('bounds the strings a person reads in a failure message', async () => {
      expect(typeof parseExpect({ ref: 'e1', value: 'x'.repeat(MAX_EXPECT_TEXT + 1) })).toBe('string');
      expect(typeof parseExpect({ query: { role: 'button' }, text: 'x'.repeat(MAX_EXPECT_TEXT + 1) })).toBe(
        'string',
      );
      expect(typeof parseExpect({ ref: 'e1', value: 'x'.repeat(MAX_EXPECT_TEXT) })).toBe('object');
    });

    await it('refuses an unknown key instead of dropping it', async () => {
      // Dropping it would answer a different question than the one asked, and say so as a pass.
      expect(parseExpect({ ref: 'e1', state: 'visible', waitFor: 5 })).toBe('unknown key "waitFor"');
      expect(parseExpect('e1')).toBe('params must be an object');
      expect(parseExpect([{ ref: 'e1' }])).toBe('params must be an object');
    });
  });

  await describe('expectationOf', async () => {
    await it('names what was wanted, in words a failure can repeat', async () => {
      // Built here rather than in the failure branch: a message that only exists on the way out is a
      // message nobody checks.
      const req = parseExpect({ ref: 'e4', state: 'visible' }) as { ref: string };
      expect(expectationOf(req as never)).toBe('ref e4 to be visible');
    });

    await it('reads as a sentence when several conditions are combined', async () => {
      const req = parseExpect({
        query: { role: 'textbox', name: 'Comment' },
        state: 'enabled',
        value: 'Hallo',
      }) as never;
      expect(expectationOf(req)).toBe('the textbox "Comment" to be enabled and value "Hallo"');
    });

    await it('keeps a count of one in the singular', async () => {
      expect(expectationOf(parseExpect({ query: { role: 'button' }, count: 1 }) as never)).toBe(
        'the button to be exactly 1 match',
      );
      expect(expectationOf(parseExpect({ query: { role: 'button' }, count: 0 }) as never)).toBe(
        'the button to be exactly 0 matches',
      );
    });

    await it('names the query, because "the query" is not a sentence a reader can act on', async () => {
      // The two halves of a failure report are `expected` and `seen`. If `expected` says "the query",
      // the agent has to look up which query it asked — the one thing the caller always knows and the
      // report is supposed to carry. `describeQuery` is the same wording the recipe runner uses.
      expect(
        expectationOf(
          parseExpect({ query: { role: 'button', name: 'Gate save' }, state: 'hidden' }) as never,
        ),
      ).toBe('the button "Gate save" to be hidden');
      expect(expectationOf(parseExpect({ query: { text: 'Ticket 3279' }, count: 0 }) as never)).toBe(
        'the element with text "Ticket 3279" to be exactly 0 matches',
      );
    });
  });
};
