import { describe, expect, it } from '@gjsify/unit';

import { withheldFrameLine } from '@beifahrer/core';

export default async () => {
  await describe('withheld frame line (issue #153)', async () => {
    await it('names the origin and both levels', async () => {
      expect(withheldFrameLine('https://ads.example', 'none', 'read')).toBe(
        '— frame withheld: https://ads.example (level none, needs read)',
      );
    });
  });
};
