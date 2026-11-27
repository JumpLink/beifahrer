import { describe, expect, it } from '@gjsify/unit';
import { FIND_ROLES, parseElementQuery, queryMatches, type ElementFacts } from '@beifahrer/core';

import { clickishName, derivedRole, type RoleFacts } from '../../../../extension/src/derived-role.ts';

const base: RoleFacts = {
  tag: 'my-save',
  role: null,
  tabindex: null,
  shadowButton: false,
  pointer: false,
  name: '',
};

export default async () => {
  await describe('derivedRole', async () => {
    await it('makes a focusable custom element a button', async () => {
      expect(derivedRole({ ...base, tabindex: 0 })).toBe('button');
      expect(derivedRole({ ...base, tabindex: -1 })).toBe(null);
    });

    await it('makes a custom element with a button in its shadow root a button', async () => {
      expect(derivedRole({ ...base, shadowButton: true })).toBe('button');
    });

    await it('needs a pointer cursor AND a command-like name, not either alone', async () => {
      expect(derivedRole({ ...base, pointer: true, name: 'Speichern' })).toBe('button');
      expect(derivedRole({ ...base, pointer: true, name: 'Quarterly numbers' })).toBe(null);
      expect(derivedRole({ ...base, pointer: false, name: 'Save' })).toBe(null);
    });

    await it('leaves native tags and declared roles alone', async () => {
      expect(derivedRole({ ...base, tag: 'div', tabindex: 0 })).toBe(null);
      expect(derivedRole({ ...base, role: 'presentation', tabindex: 0 })).toBe(null);
    });

    await it('reads a name as words, in German too', async () => {
      expect(clickishName('Jetzt abbrechen!')).toBe(true);
      expect(clickishName('Okayish')).toBe(false);
    });
  });

  await describe('option as a find role', async () => {
    await it('is a role find accepts and filters by, native and ARIA alike', async () => {
      expect(FIND_ROLES.includes('option')).toBe(true);
      const page: ElementFacts[] = [
        { role: 'combobox', name: 'Country', text: '' },
        { role: 'option', name: 'Germany', text: 'Germany' },
        { role: 'option', name: 'France', text: 'France' },
      ];
      const hits = page.filter((e) => queryMatches({ role: 'option', name: 'germ' }, e));
      expect(hits.length).toBe(1);
      expect(parseElementQuery({ role: 'option' })).toStrictEqual({ role: 'option' });
    });
  });
};
