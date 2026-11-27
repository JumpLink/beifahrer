import { describe, expect, it } from '@gjsify/unit';

import { checkUpload } from '../../../../extension/src/upload-check.ts';

export default async () => {
  await describe('checkUpload', async () => {
    await it('is accepted when the page clears the field in its change handler (the false negative)', async () => {
      // Judged after the events, as before, the field is empty: 0 !== 1.
      const afterOnly = checkUpload(['a.png'], [], []);
      expect(afterOnly.accepted).toBe(false);
      // Judged from what the field held when the page was told, the upload counts, and `cleared` says why it is empty now.
      const out = checkUpload(['a.png'], [{ name: 'a.png' }], []);
      expect(out.accepted).toBe(true);
      expect(out.cleared).toBe(true);
    });

    await it('is accepted and not cleared when the field keeps the files', async () => {
      const held = [{ name: 'a.png' }, { name: 'b.png' }];
      const out = checkUpload(['a.png', 'b.png'], held, held);
      expect(out).toStrictEqual({ accepted: true, cleared: false });
    });

    await it('is not accepted when the browser dropped a file or reordered them', async () => {
      expect(checkUpload(['a.png', 'b.png'], [{ name: 'a.png' }], []).accepted).toBe(false);
      expect(checkUpload(['a.png', 'b.png'], [{ name: 'b.png' }, { name: 'a.png' }], []).accepted).toBe(
        false,
      );
      expect(checkUpload(['a.png'], [], []).cleared).toBe(false);
    });
  });
};
