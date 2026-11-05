import { describe, expect, it } from '@gjsify/unit';

import { createTranslate } from '../../../src/window/i18n.ts';
import { helperPathOf, parseSafariState, safariView } from '../../../src/window/safari-model.ts';

export default async () => {
  await describe('parseSafariState', async () => {
    await it("reads the helper's exact two words", async () => {
      expect(parseSafariState('enabled')).toBe('enabled');
      expect(parseSafariState('disabled')).toBe('disabled');
    });

    await it('is unknown for anything else, trimming surrounding whitespace', async () => {
      expect(parseSafariState('enabled\n')).toBe('enabled');
      expect(parseSafariState('  disabled  ')).toBe('disabled');
      expect(parseSafariState('')).toBe('unknown');
      expect(parseSafariState('SFErrorDomain …')).toBe('unknown');
      expect(parseSafariState('Enabled')).toBe('unknown');
    });
  });

  await describe('helperPathOf', async () => {
    await it('sits beside the bundle on darwin, whichever of the two paths node runs from', async () => {
      expect(helperPathOf('darwin', '/Applications/Beifahrer.app/Contents/Helpers/beifahrer')).toBe(
        '/Applications/Beifahrer.app/Contents/Helpers/safari-ext-helper',
      );
      expect(helperPathOf('darwin', '/Applications/Beifahrer.app/Contents/MacOS/beifahrer')).toBe(
        '/Applications/Beifahrer.app/Contents/Helpers/safari-ext-helper',
      );
    });

    await it('is null off macOS, outside a bundle, or without an execPath', async () => {
      expect(helperPathOf('linux', '/usr/bin/beifahrer')).toBe(null);
      expect(helperPathOf('darwin', '/usr/local/bin/node')).toBe(null);
      expect(helperPathOf('darwin', undefined)).toBe(null);
      expect(helperPathOf('darwin', null)).toBe(null);
    });
  });

  await describe('safariView', async () => {
    const t = createTranslate('en');

    await it('is visible only on macOS AND with the helper in the bundle', async () => {
      expect(safariView('darwin', true, 'unknown', t).visible).toBe(true);
      expect(safariView('linux', true, 'unknown', t).visible).toBe(false);
      expect(safariView('win32', true, 'enabled', t).visible).toBe(false);
      // The bug this guards: a dev build or a Linux host has no helper at all, so showing
      // anything (even "Unknown") would be a row with nothing it could ever read or open.
      expect(safariView('darwin', false, 'unknown', t).visible).toBe(false);
      expect(safariView('darwin', false, 'enabled', t).visible).toBe(false);
    });

    await it('carries the state word untranslated and a translated sentence beside it', async () => {
      const v = safariView('darwin', true, 'enabled', t);
      expect(v.state).toBe('enabled');
      expect(v.stateText.length > 0).toBe(true);
      expect(v.hint.length > 0).toBe(true);
    });

    await it("never offers an action on the browser's policy: the view has no field for one", async () => {
      // ADR 0017/0026: no pause, resume, feature switch or site level — only read-only state.
      expect(
        Object.keys(safariView('darwin', true, 'disabled', t))
          .sort()
          .join(),
      ).toBe('hint,state,stateText,visible');
    });

    await it("follows the person's language", async () => {
      expect(safariView('darwin', true, 'enabled', createTranslate('de')).stateText).not.toBe(
        safariView('darwin', true, 'enabled', t).stateText,
      );
    });
  });
};
