import { describe, expect, it } from '@gjsify/unit';
import {
  MAX_SOURCE_CONTEXT,
  MAX_SOURCE_HITS,
  MAX_SOURCE_PATTERN,
  MAX_SOURCE_SLICE,
  compilePattern,
  matchesFilter,
  parseSources,
  searchText,
  sliceText,
  sourceKind,
  sourceMapOf,
  sourceUrl,
  type SourcesRequest,
} from '@beifahrer/core';

// `page_sources` (issue #234) reads code the site serves to every visitor. What is worth pinning:
// the input is validated and capped before anything runs, a search cannot loop or flood, and a URL
// never carries its query into an answer.
const ok = (raw: unknown): SourcesRequest => {
  const r = parseSources(raw);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

export default async () => {
  await describe('parseSources', async () => {
    await it('fills the defaults', async () => {
      const r = ok({ tabId: 1, action: 'list' });
      expect(r.action).toBe('list');
      expect(r.literal).toBe(false);
      expect(r.maxHits).toBe(20);
      expect(r.context).toBe(80);
    });

    await it('clamps what exceeds a cap instead of running it', async () => {
      const r = ok({ action: 'search', pattern: 'x', maxHits: 9999, context: 99999 });
      expect(r.maxHits).toBe(MAX_SOURCE_HITS);
      expect(r.context).toBe(MAX_SOURCE_CONTEXT);
      expect(ok({ action: 'slice', url: 'https://example.org/a.js', length: 10 ** 9 }).length).toBe(
        MAX_SOURCE_SLICE,
      );
    });

    await it('refuses what is not a request', async () => {
      expect(typeof parseSources(null)).toBe('string');
      expect(typeof parseSources({ action: 'nope' })).toBe('string');
      expect(typeof parseSources({ action: 'list', surprise: 1 })).toBe('string');
      expect(typeof parseSources({ action: 'search' })).toBe('string');
      expect(typeof parseSources({ action: 'slice' })).toBe('string');
      expect(typeof parseSources({ action: 'list', maxHits: 0 })).toBe('string');
      expect(typeof parseSources({ action: 'list', literal: 'yes' })).toBe('string');
      expect(typeof parseSources({ action: 'search', pattern: 'a'.repeat(MAX_SOURCE_PATTERN + 1) })).toBe(
        'string',
      );
    });
  });

  await describe('compilePattern', async () => {
    await it('escapes a literal and reports a broken expression', async () => {
      const lit = compilePattern('a.b(', true);
      if (typeof lit === 'string') throw new Error(lit);
      expect(lit.test('xa.b(y')).toBe(true);
      lit.lastIndex = 0;
      expect(lit.test('axb(')).toBe(false);
      expect(typeof compilePattern('a(', false)).toBe('string');
    });
  });

  await describe('searchText', async () => {
    const re = (p: string) => compilePattern(p, true) as RegExp;

    await it('returns the match with context and its offset', async () => {
      const hits = searchText('u', 'aaa/api/v2/flagsbbb', re('/api/v2'), 3, 10);
      expect(hits.length).toBe(1);
      expect(hits[0]!.offset).toBe(3);
      expect(hits[0]!.text).toBe('aaa/api/v2/fl');
    });

    await it('stops at the room it was given', async () => {
      expect(searchText('u', 'x x x x x', re('x'), 0, 3).length).toBe(3);
    });

    await it('ends on an empty match', async () => {
      const empty = compilePattern('z*', false) as RegExp;
      expect(searchText('u', 'abc', empty, 0, 100).length > 0).toBe(true);
    });
  });

  await describe('sliceText', async () => {
    await it('reads a window and says whether more follows', async () => {
      const part = sliceText('0123456789', 2, 3);
      expect(part.text).toBe('234');
      expect(part.total).toBe(10);
      expect(part.more).toBe(true);
      expect(sliceText('0123456789', 8, 5).more).toBe(false);
      expect(sliceText('0123', 99, 5).text).toBe('');
    });
  });

  await describe('sourceMapOf', async () => {
    await it('reports the map a script names, without query, and not an inline one', async () => {
      expect(sourceMapOf('code();\n//# sourceMappingURL=app.js.map?v=3')).toBe('app.js.map');
      expect(sourceMapOf('code();\n//# sourceMappingURL=data:application/json;base64,AAAA')).toBe(undefined);
      expect(sourceMapOf('code();')).toBe(undefined);
    });
  });

  await describe('sourceKind and sourceUrl', async () => {
    await it('lists scripts and fetched .js files, nothing else', async () => {
      expect(sourceKind('script', 'https://example.org/a.js')).toBe('script');
      expect(sourceKind('xmlhttprequest', 'https://example.org/w.mjs?v=1')).toBe('fetched');
      expect(sourceKind('fetch', 'https://example.org/data.json')).toBe(null);
      expect(sourceKind('image', 'https://example.org/a.js')).toBe(null);
    });

    await it('drops the query and refuses a non-http URL', async () => {
      expect(sourceUrl('https://example.org/a.js?token=secret#x')).toBe('https://example.org/a.js');
      expect(sourceUrl('data:text/javascript,alert(1)')).toBe('');
    });

    await it('filters by substring, case-insensitively', async () => {
      expect(matchesFilter('https://example.org/Vendor.js', 'vendor')).toBe(true);
      expect(matchesFilter('https://example.org/a.js', 'vendor')).toBe(false);
      expect(matchesFilter('https://example.org/a.js')).toBe(true);
    });
  });
};
