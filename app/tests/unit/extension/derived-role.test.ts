import { describe, expect, it } from '@gjsify/unit';
import { FIND_ROLES, parseElementQuery, queryMatches, type ElementFacts } from '@beifahrer/core';

import {
  clickishName,
  derivedRole,
  wrappedButton,
  type RoleFacts,
} from '../../../../extension/src/derived-role.ts';

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

  await describe('wrappedButton', async () => {
    // The shadow root of a design-system button host: ONE <button tabindex="0"> plus spans and slots.
    interface Fake {
      tag: string;
      kids: Fake[];
      contains(other: unknown): boolean;
    }
    const node = (tag: string, ...kids: Fake[]): Fake => {
      const self: Fake = {
        tag,
        kids,
        contains: (other) => other === self || kids.some((k) => k.contains(other)),
      };
      return self;
    };
    const flat = (nodes: Fake[]): Fake[] => nodes.flatMap((n) => [n, ...flat(n.kids)]);
    // Selector words are matched as tag names; `[tabindex]` is the tags named in `focusable`.
    const rootOf = (nodes: Fake[], focusable: string[]) => {
      const all = flat(nodes);
      const pick = (sel: string): Fake[] =>
        sel === '[tabindex]'
          ? all.filter((n) => n.tag === 'button' || focusable.includes(n.tag))
          : sel === 'button, [role="button"]'
            ? all.filter((n) => n.tag === 'button')
            : all.filter((n) => sel.split(',').some((t) => t.trim() === n.tag));
      return { querySelectorAll: pick, querySelector: (sel: string) => pick(sel)[0] ?? null };
    };

    await it('accepts the one button even though it carries tabindex=0', async () => {
      const root = rootOf([node('button', node('span'), node('slot')), node('span')], []);
      expect(wrappedButton(root) !== null).toBe(true);
    });

    await it('refuses a second focusable element beside the button', async () => {
      const root = rootOf([node('button'), node('span')], ['span']);
      expect(wrappedButton(root)).toBe(null);
    });

    await it('refuses a field or link beside the button, and several buttons', async () => {
      expect(wrappedButton(rootOf([node('button'), node('input')], []))).toBe(null);
      expect(wrappedButton(rootOf([node('button'), node('button')], []))).toBe(null);
      expect(wrappedButton(null)).toBe(null);
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
