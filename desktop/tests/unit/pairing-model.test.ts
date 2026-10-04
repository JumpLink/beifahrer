import { describe, expect, it } from '@gjsify/unit';

import { createTranslate } from '../../src/i18n.ts';
import { pairingView } from '../../src/pairing-model.ts';

const t = createTranslate('en');

export default async () => {
  await describe('pairing view', async () => {
    await it('carries the token and where it lives, with nothing to warn about', async () => {
      const v = pairingView({ token: 'tok-1', path: '/c/beifahrer/token', other: null }, t);
      expect(v.token).toBe('tok-1');
      expect(v.path).toBe('/c/beifahrer/token');
      expect(v.error).toBe(null);
      expect(v.warnings.length).toBe(0);
    });

    await it('warns about a second token file and names it, without its content', async () => {
      const v = pairingView({ token: 'tok-1', path: '/a', other: '/home/p/.config/beifahrer/token' }, t);
      expect(v.warnings.length).toBe(1);
      expect(v.warnings[0]!.description).toMatch(
        /\/home\/p\/\.config\/beifahrer\/token holds a different token/,
      );
      expect(JSON.stringify(v.warnings)).not.toMatch(/tok-1/);
    });

    await it('says why when the token could not be read, and offers nothing to copy', async () => {
      const v = pairingView(new Error('EACCES'), t);
      expect(v.token).toBe(null);
      expect(v.error).toBe('The token could not be read: EACCES');
    });

    await it('speaks German', async () => {
      const v = pairingView(new Error('EACCES'), createTranslate('de'));
      expect(v.error).toBe('Das Token konnte nicht gelesen werden: EACCES');
    });
  });
};
