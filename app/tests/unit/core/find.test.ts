import { describe, expect, it } from '@gjsify/unit';

import {
  describeQuery,
  metaMatches,
  normalizeText,
  parseElementQuery,
  parseMetaQuery,
  queryMatches,
} from '@beifahrer/core';

// Element queries are how agents and recipes name an element without a ref and without code. The
// dangerous direction is a query that matches MORE than its author meant — the next step clicks it.
export default async () => {
  await describe('parseElementQuery', async () => {
    await it('accepts role, name (one or several), text and nth', async () => {
      const q = parseElementQuery({ role: 'button', name: ['Senden', 'Send'], text: 'x', nth: 2 });
      expect(JSON.stringify(q)).toBe(
        JSON.stringify({ role: 'button', name: ['Senden', 'Send'], text: 'x', nth: 2 }),
      );
    });

    await it('refuses refs, selectors and code by name, with the reason', async () => {
      expect(parseElementQuery({ role: 'button', ref: 'e12' }) as string).toMatch(
        /refs belong to one page load/,
      );
      expect(parseElementQuery({ selector: '#send' }) as string).toMatch(/no selectors/);
      expect(parseElementQuery({ xpath: '//button' }) as string).toMatch(/no selectors/);
      expect(parseElementQuery({ css: 'button' }) as string).toMatch(/no selectors/);
      expect(parseElementQuery({ script: 'alert(1)' }) as string).toMatch(/runs no supplied code/);
    });

    await it('refuses any other unknown key instead of ignoring it', async () => {
      expect(parseElementQuery({ role: 'button', label: 'Send' }) as string).toMatch(/unknown key "label"/);
    });

    await it('refuses an empty query — it would match everything', async () => {
      expect(parseElementQuery({}) as string).toMatch(/at least one of/);
      expect(parseElementQuery({ nth: 0 }) as string).toMatch(/at least one of/);
    });

    await it('refuses unknown roles, bad nth, empty and oversize strings, non-objects', async () => {
      expect(typeof parseElementQuery({ role: 'iframe' })).toBe('string');
      expect(typeof parseElementQuery({ role: 'button', nth: -1 })).toBe('string');
      expect(typeof parseElementQuery({ role: 'button', nth: 1.5 })).toBe('string');
      expect(typeof parseElementQuery({ role: 'button', nth: 100 })).toBe('string');
      expect(typeof parseElementQuery({ name: '' })).toBe('string');
      expect(typeof parseElementQuery({ name: '   ' })).toBe('string');
      expect(typeof parseElementQuery({ name: 'x'.repeat(201) })).toBe('string');
      expect(typeof parseElementQuery({ name: [] })).toBe('string');
      expect(typeof parseElementQuery({ name: Array(11).fill('a') })).toBe('string');
      expect(typeof parseElementQuery({ name: [1] })).toBe('string');
      expect(typeof parseElementQuery(null)).toBe('string');
      expect(typeof parseElementQuery('button')).toBe('string');
      expect(typeof parseElementQuery([{ role: 'button' }])).toBe('string');
    });
  });

  await describe('queryMatches', async () => {
    const button = { role: 'button' as const, name: 'Kommentar\n  absenden', text: 'Senden' };

    await it('matches a case- and whitespace-insensitive substring of the name', async () => {
      expect(queryMatches({ name: 'kommentar absenden' }, button)).toBe(true);
      expect(queryMatches({ name: 'ABSENDEN' }, button)).toBe(true);
      expect(queryMatches({ name: 'löschen' }, button)).toBe(false);
    });

    await it('treats several names as alternatives', async () => {
      expect(queryMatches({ name: ['Submit comment', 'Kommentar absenden'] }, button)).toBe(true);
      expect(queryMatches({ name: ['Submit comment', 'Delete'] }, button)).toBe(false);
    });

    await it('requires every given part: role AND name AND text', async () => {
      expect(queryMatches({ role: 'link', name: 'absenden' }, button)).toBe(false);
      expect(queryMatches({ role: 'button', name: 'absenden', text: 'senden' }, button)).toBe(true);
      expect(queryMatches({ role: 'button', name: 'absenden', text: 'nope' }, button)).toBe(false);
    });

    await it('never treats the name as a pattern', async () => {
      expect(queryMatches({ name: '.*' }, button)).toBe(false);
      expect(queryMatches({ name: 'Kommentar.absenden' }, button)).toBe(false);
    });
  });

  await describe('meta checks', async () => {
    await it('validate the name and refuse extra keys', async () => {
      expect(JSON.stringify(parseMetaQuery({ name: 'generator', content: 'OpenProject' }))).toBe(
        JSON.stringify({ name: 'generator', content: 'OpenProject' }),
      );
      expect(typeof parseMetaQuery({ name: 'a b' })).toBe('string');
      expect(typeof parseMetaQuery({ name: 'generator', value: 'x' })).toBe('string');
      expect(typeof parseMetaQuery({})).toBe('string');
    });

    await it('match the name exactly (case-insensitively) and the content as a substring', async () => {
      expect(metaMatches({ name: 'app_base_path' }, { name: 'APP_BASE_PATH', content: '' })).toBe(true);
      expect(metaMatches({ name: 'app_base' }, { name: 'app_base_path', content: '' })).toBe(false);
      expect(
        metaMatches(
          { name: 'generator', content: 'openproject' },
          { name: 'generator', content: 'OpenProject 16' },
        ),
      ).toBe(true);
      expect(
        metaMatches({ name: 'generator', content: 'gitlab' }, { name: 'generator', content: 'OpenProject' }),
      ).toBe(false);
    });
  });

  await describe('helpers', async () => {
    await it('normalizeText and describeQuery', async () => {
      expect(normalizeText('  A\n\tB  ')).toBe('a b');
      expect(describeQuery({ role: 'button', name: ['A', 'B'], nth: 1 })).toBe('button "A" | "B" #1');
      expect(describeQuery({ text: 'x' })).toBe('element with text "x"');
    });
  });
};
