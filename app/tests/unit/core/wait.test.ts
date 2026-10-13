import { describe, expect, it } from '@gjsify/unit';
import { pageWentAway, waitAcrossNavigation } from '@beifahrer/core';

// A `wait` is answered from inside the document, and a navigation (the TAN form of a login) destroys
// that document. The retry rules are decided here, with a scripted clock and scripted failures.
export default async () => {
  await describe('pageWentAway', async () => {
    await it('knows the messages of a document that was replaced', async () => {
      for (const m of [
        'could not reach the page: Could not establish connection. Receiving end does not exist.',
        'The message port closed before a response was received.',
        "Actor 'Conduits' destroyed before query 'RuntimeMessage' was resolved",
      ])
        expect(pageWentAway(m)).toBe(true);
    });

    await it('leaves every other failure alone', async () => {
      for (const m of ['timeout waiting for button "x"', 'forbidden', 'the page did not answer'])
        expect(pageWentAway(m)).toBe(false);
    });
  });

  await describe('waitAcrossNavigation', async () => {
    const gone = new Error('could not reach the page: Receiving end does not exist.');

    await it('asks again after the document is replaced, with the time that is left', async () => {
      let t = 0;
      const lefts: number[] = [];
      let settled = 0;
      const answer = await waitAcrossNavigation({
        deadline: 1000,
        now: () => t,
        attempt: async (left) => {
          lefts.push(left);
          t += 300;
          if (lefts.length < 3) throw gone;
          return 'found';
        },
        settle: async () => {
          settled++;
        },
        messageOf: (e) => (e as Error).message,
      });
      expect(answer).toBe('found');
      expect(settled).toBe(2);
      expect(lefts).toStrictEqual([1000, 700, 400]);
    });

    await it('gives up with the browser error once the deadline has passed', async () => {
      let t = 0;
      let failure: unknown;
      try {
        await waitAcrossNavigation({
          deadline: 500,
          now: () => t,
          attempt: async () => {
            t += 300;
            throw gone;
          },
          settle: async () => {},
          messageOf: (e) => (e as Error).message,
        });
      } catch (e) {
        failure = e;
      }
      expect(failure).toBe(gone);
    });

    await it('does not retry a failure that is not a lost document', async () => {
      let asked = 0;
      const timeout = new Error('timeout waiting for button');
      let failure: unknown;
      try {
        await waitAcrossNavigation({
          deadline: 10_000,
          now: () => 0,
          attempt: async () => {
            asked++;
            throw timeout;
          },
          settle: async () => {},
          messageOf: (e) => (e as Error).message,
        });
      } catch (e) {
        failure = e;
      }
      expect(failure).toBe(timeout);
      expect(asked).toBe(1);
    });
  });
};
