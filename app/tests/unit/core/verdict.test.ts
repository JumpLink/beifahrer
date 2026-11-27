import { describe, expect, it } from '@gjsify/unit';
import { verdictOf } from '@beifahrer/core';

const at = (n: number, extra: Partial<{ doc: string; url: string }> = {}) => ({
  doc: 'd1',
  url: 'https://x.test/a',
  n,
  ...extra,
});

export default async () => {
  await describe('verdictOf', async () => {
    await it('says none when the same document had no real mutation', async () => {
      expect(verdictOf(at(3), at(3))).toStrictEqual({ change: 'none' });
    });

    await it('says changed when the mutation counter moved', async () => {
      expect(verdictOf(at(3), at(5))).toStrictEqual({ change: 'changed' });
    });

    await it('says navigated, with the new address, when the document was replaced', async () => {
      expect(verdictOf(at(3), at(0, { doc: 'd2', url: 'https://x.test/b' }))).toStrictEqual({
        change: 'navigated',
        url: 'https://x.test/b',
      });
    });

    await it('says navigated when only the address moved (pushState)', async () => {
      expect(verdictOf(at(3), at(4, { url: 'https://x.test/c' }))).toStrictEqual({
        change: 'navigated',
        url: 'https://x.test/c',
      });
    });

    await it('says navigated when the old document no longer answers, naming where it landed if known', async () => {
      expect(verdictOf(at(3), undefined)).toStrictEqual({ change: 'navigated' });
      expect(verdictOf(at(3), undefined, 'https://x.test/d')).toStrictEqual({
        change: 'navigated',
        url: 'https://x.test/d',
      });
    });

    await it('says changed, not none, when there was no baseline to compare with', async () => {
      expect(verdictOf(undefined, at(1))).toStrictEqual({ change: 'changed' });
    });
  });
};
