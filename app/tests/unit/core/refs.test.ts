import { describe, expect, it } from '@gjsify/unit';
import { frameOfRef, localRef, namespaceRefs, parseRef, withFrame } from '@beifahrer/core';

// A ref is `e12` in the page's own document and `b2e12` in a frame. The frame being PART OF THE REF
// is a safety decision (issue #32): each frame runs its own page agent with its own registry, so `e3`
// exists once per frame and those are different elements. An ambiguous ref in a write is a write on
// the wrong element — and in a frame on another origin, a write in the name of a site the person
// never allowed. These tests pin the grammar and the round trip; the routing is the e2e's job.
export default async () => {
  await describe('parseRef', async () => {
    await it('reads a bare ref as the page itself', async () => {
      expect(parseRef('e12')).toStrictEqual({ frame: 0, local: 'e12' });
      expect(parseRef('e1')).toStrictEqual({ frame: 0, local: 'e1' });
    });

    await it('reads a frame ref, and keeps the local part for the frame to understand', async () => {
      // The frame's own agent hands out `e12`; the prefix is added and removed outside it, so inside
      // the frame a ref is always the bare one.
      expect(parseRef('b2e12')).toStrictEqual({ frame: 2, local: 'e12' });
      expect(parseRef('b1e1')).toStrictEqual({ frame: 1, local: 'e1' });
    });

    await it('refuses anything that is not a ref, rather than guessing at one', async () => {
      // Fail closed. A ref that "looks close" and is acted on anyway is a click on the wrong
      // element, and a ref that reaches a frame is a click in another origin.
      for (const raw of [
        '',
        'e',
        'e0',
        'ee1',
        'E1',
        'e1x',
        'x1e1',
        'b0e1',
        'be1',
        'b2',
        'b2x1',
        'b2E1',
        '#e1',
        'e1;drop',
        12,
        null,
        undefined,
        {},
      ])
        expect(typeof parseRef(raw)).toBe('string');
    });

    await it('says what a ref should look like, so a wrong one can be corrected', async () => {
      const refused = parseRef('nonsense') as string;
      expect(refused).toContain('e12');
      expect(refused).toContain('b2e12');
    });
  });

  await describe('frameOfRef', async () => {
    await it('is 0 for the page and the frame number for a frame', async () => {
      expect(frameOfRef('e7')).toBe(0);
      expect(frameOfRef('b3e7')).toBe(3);
    });

    await it('is 0 for something that is not a ref, so a bad ref stays a bad ref', async () => {
      // Not the frame of a guess. A ref that does not parse must not be routed to frame 0 as if it
      // were the page's own; the handler refuses it before it gets here.
      expect(frameOfRef('nonsense')).toBe(0);
    });
  });

  await describe('withFrame and localRef', async () => {
    await it('round trips a ref through a frame and back', async () => {
      expect(localRef(withFrame('e12', 2))).toBe('e12');
      expect(localRef(withFrame('e12', 0))).toBe('e12');
    });

    await it("leaves the page's own refs bare, so nothing existing changes shape", async () => {
      // Every ref the agent already knows stays as it was. That is what keeps this additive: a
      // recipe written before frames existed still addresses the same elements.
      expect(withFrame('e12', 0)).toBe('e12');
    });

    await it('replaces a frame part rather than stacking two of them', async () => {
      expect(withFrame('b2e12', 3)).toBe('b3e12');
    });

    await it('passes a ref it cannot parse through unchanged, for the caller to refuse', async () => {
      expect(withFrame('nonsense', 2)).toBe('nonsense');
      expect(localRef('nonsense')).toBe('nonsense');
    });
  });

  await describe('namespaceRefs', async () => {
    await it('names the refs in an outline line', async () => {
      expect(namespaceRefs('[e12] button "Save"', 2)).toBe('[b2e12] button "Save"');
    });

    await it('names the refs inside a found element, in both fields', async () => {
      const found = JSON.stringify({ matches: [{ ref: 'e5', description: 'textbox "Name" = "x"' }] });
      expect(namespaceRefs(found, 3)).toContain('"ref":"b3e5"');
    });

    await it('names every occurrence, not only the first', async () => {
      const text = '[e1] a [e2] b [e3] c';
      expect(namespaceRefs(text, 2)).toBe('[b2e1] a [b2e2] b [b2e3] c');
    });

    await it("leaves the page's own answer untouched", async () => {
      const text = '[e1] button "Save"';
      expect(namespaceRefs(text, 0)).toBe(text);
    });

    await it('does not re-name a ref that already carries a frame', async () => {
      // A frame's own answer never contains one, so this cannot arise from the walk — but if it ever
      // did, doubling the prefix would produce `b2b2e1`, a ref that addresses nothing, silently. The
      // pattern only matches a ref that FOLLOWS a bracket or a quote, and `b2e1` has `2` in front of
      // its `e`, so it passes through untouched.
      expect(namespaceRefs('[b2e1] a', 2)).toBe('[b2e1] a');
      expect(namespaceRefs('[b2e1] a', 0)).toBe('[b2e1] a');
    });
  });
};
