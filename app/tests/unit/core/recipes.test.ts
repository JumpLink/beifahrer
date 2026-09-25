import { describe, expect, it } from '@gjsify/unit';

import {
  MAX_RECIPE_BYTES,
  checkRunParams,
  parseRecipe,
  urlPatternMatches,
  urlsMatch,
  type Recipe,
} from '@beifahrer/core';

import { BUILTIN } from '../../../src/recipes/builtin.ts';

/** A minimal valid recipe; each test breaks one thing. */
function valid(): Record<string, unknown> {
  return {
    id: 'demo/add-note',
    title: 'Add a note',
    description: 'Opens the note box and fills it.',
    version: '1.0.0',
    match: { urls: ['https://*.example.org/*'] },
    params: [{ name: 'text', type: 'string', description: 'The note', required: true }],
    steps: [
      { id: 'open', action: 'click', target: { role: 'button', name: 'Add note' } },
      { id: 'wait', action: 'wait', for: { role: 'richtext' }, timeoutMs: 5000 },
      { id: 'fill', action: 'fill', target: { role: 'richtext' }, param: 'text', as: 'html' },
      { id: 'look', action: 'checkpoint', message: 'Check the draft' },
      {
        id: 'send',
        action: 'submit',
        target: { role: 'button', name: 'Save' },
        requiresExplicitRequest: true,
      },
    ],
  };
}

function withStep(step: Record<string, unknown>): Record<string, unknown> {
  const r = valid();
  (r.steps as unknown[]).push(step);
  return r;
}

const refused = (raw: unknown, reason: RegExp) => {
  const r = parseRecipe(raw);
  expect(typeof r).toBe('string');
  expect(r as string).toMatch(reason);
};

export default async () => {
  await describe('parseRecipe: valid', async () => {
    await it('accepts a complete recipe and normalises a single matcher into a list', async () => {
      const r = parseRecipe(valid()) as Recipe;
      expect(typeof r).toBe('object');
      expect(r.match.length).toBe(1);
      expect(r.steps.map((s) => s.action).join(',')).toBe('click,wait,fill,checkpoint,submit');
    });

    await it('accepts wait for load, read, outline, find and several matchers', async () => {
      const r = valid();
      r.match = [{ urls: ['https://a.example/*'] }, { fingerprint: [{ meta: { name: 'generator' } }] }];
      r.steps = [
        { id: 'load', action: 'wait', for: 'load' },
        { id: 'find', action: 'find', target: { role: 'heading', text: 'Ticket' } },
        { id: 'read', action: 'read', maxChars: 500 },
        { id: 'outline', action: 'outline' },
      ];
      expect(typeof parseRecipe(r)).toBe('object');
    });

    await it('every built-in recipe is valid', async () => {
      for (const file of BUILTIN) {
        const r = parseRecipe(file.data);
        if (typeof r === 'string') throw new Error(`${file.source}: ${r}`);
        expect(r.steps.at(-1)?.requiresExplicitRequest).toBe(true);
      }
    });
  });

  await describe('parseRecipe: refuses (fail closed)', async () => {
    await it('unknown step types — there is no evaluate', async () => {
      refused(withStep({ id: 'x', action: 'evaluate', code: '1' }), /steps\[5\]\.action: must be one of/);
      refused(withStep({ id: 'x', action: 'navigate' }), /must be one of/);
      refused(withStep({ id: 'x' }), /must be one of/);
    });

    await it('refs, selectors and code anywhere a step could carry them', async () => {
      refused(withStep({ id: 'x', action: 'click', ref: 'e12' }), /never by ref/);
      refused(withStep({ id: 'x', action: 'click', target: { ref: 'e12' } }), /refs belong to one page load/);
      refused(
        withStep({ id: 'x', action: 'click', selector: '#a', target: { role: 'button' } }),
        /no selectors/,
      );
      refused(withStep({ id: 'x', action: 'click', target: { css: '.a' } }), /no selectors/);
      refused(withStep({ id: 'x', action: 'read', script: 'fetch(1)' }), /carries no code/);
      refused({ ...valid(), code: 'x' }, /carries no code/);
      refused({ ...valid(), onLoad: 'x' }, /unknown key "onLoad"/);
    });

    await it('a submit not marked requiresExplicitRequest', async () => {
      refused(withStep({ id: 'x', action: 'submit', target: { role: 'button' } }), /must be marked/);
      refused(
        withStep({ id: 'x', action: 'submit', target: { role: 'button' }, requiresExplicitRequest: false }),
        /must be marked/,
      );
      refused(
        withStep({ id: 'x', action: 'click', target: { role: 'button' }, requiresExplicitRequest: 'yes' }),
        /boolean/,
      );
    });

    await it('fill from an undeclared param, duplicate params and step ids', async () => {
      refused(
        withStep({ id: 'x', action: 'fill', target: { role: 'textbox' }, param: 'body' }),
        /not a declared param/,
      );
      const dupParam = valid();
      (dupParam.params as unknown[]).push({
        name: 'text',
        type: 'string',
        description: 'again',
        required: false,
      });
      refused(dupParam, /declared twice/);
      refused(withStep({ id: 'open', action: 'read' }), /used twice/);
    });

    await it('params of another type or without description', async () => {
      const r = valid();
      r.params = [{ name: 'n', type: 'number', description: 'x', required: true }];
      refused(r, /must be "string"/);
      r.params = [{ name: 'n', type: 'string', required: true }];
      refused(r, /description/);
      r.params = [{ name: 'n', type: 'string', description: 'x' }];
      refused(r, /required/);
    });

    await it('bad ids, versions, match and wait bounds', async () => {
      refused({ ...valid(), id: 'no-slash' }, /<app>\/<task>/);
      refused({ ...valid(), id: '../evil/x' }, /<app>\/<task>/);
      refused({ ...valid(), version: 'latest' }, /1\.0\.0/);
      refused({ ...valid(), match: {} }, /urls, fingerprint or both/);
      refused({ ...valid(), match: [] }, /1 to 10/);
      refused({ ...valid(), match: { urls: ['javascript:alert(1)'] } }, /not a match pattern/);
      refused({ ...valid(), match: { urls: ['file:///etc/*'] } }, /not a match pattern/);
      refused(
        { ...valid(), match: { fingerprint: [{ find: { role: 'button' }, meta: { name: 'a' } }] } },
        /exactly one/,
      );
      refused(withStep({ id: 'x', action: 'wait', for: 'load', timeoutMs: 60_000 }), /100 to 30000/);
      refused(withStep({ id: 'x', action: 'wait', for: 'idle' }), /query must be an object/);
      refused(withStep({ id: 'Bad Id', action: 'read' }), /open-editor/);
    });

    await it('empty or oversize recipes, and things that are not recipes', async () => {
      refused({ ...valid(), steps: [] }, /1 to 50/);
      refused(
        { ...valid(), steps: Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, action: 'read' })) },
        /1 to 50/,
      );
      refused({ ...valid(), description: 'x'.repeat(MAX_RECIPE_BYTES) }, /larger than/);
      refused(null, /must be an object/);
      refused([], /must be an object/);
      refused('recipe', /must be an object/);
      const circular: Record<string, unknown> = valid();
      circular.self = circular;
      refused(circular, /not plain JSON/);
    });
  });

  await describe('checkRunParams', async () => {
    const recipe = parseRecipe(valid()) as Recipe;
    await it('passes declared string params', async () => {
      expect(JSON.stringify(checkRunParams(recipe, { text: 'hi' }))).toBe('{"text":"hi"}');
    });
    await it('refuses missing required, unknown and non-string params', async () => {
      expect(checkRunParams(recipe, {}) as string).toMatch(/missing required param "text"/);
      expect(checkRunParams(recipe, undefined) as string).toMatch(/missing required/);
      expect(checkRunParams(recipe, { text: 'a', ref: 'e1' }) as string).toMatch(/unknown param "ref"/);
      expect(checkRunParams(recipe, { text: 1 }) as string).toMatch(/must be a string/);
      expect(checkRunParams(recipe, { text: 'x'.repeat(100_001) }) as string).toMatch(/longer than/);
      expect(checkRunParams(recipe, ['a']) as string).toMatch(/must be an object/);
    });
  });

  await describe('URL match patterns', async () => {
    await it('match scheme, subdomains and path globs', async () => {
      const p = 'https://*.example.org/work_packages/*';
      expect(urlPatternMatches(p, 'https://example.org/work_packages/12')).toBe(true);
      expect(urlPatternMatches(p, 'https://op.example.org/work_packages/12/activity')).toBe(true);
      expect(urlPatternMatches(p, 'https://example.org.evil.com/work_packages/1')).toBe(false);
      expect(urlPatternMatches(p, 'https://evilexample.org/work_packages/1')).toBe(false);
      expect(urlPatternMatches(p, 'http://example.org/work_packages/1')).toBe(false);
      expect(urlPatternMatches(p, 'https://example.org/projects/1')).toBe(false);
      expect(urlPatternMatches('*://*/*', 'http://a.b/c')).toBe(true);
    });

    await it('treat ports strictly unless the pattern says :*', async () => {
      expect(urlPatternMatches('http://127.0.0.1/*', 'http://127.0.0.1:47901/x')).toBe(false);
      expect(urlPatternMatches('http://127.0.0.1:*/*', 'http://127.0.0.1:47901/x')).toBe(true);
      expect(urlPatternMatches('http://127.0.0.1:47901/*', 'http://127.0.0.1:47901/x')).toBe(true);
      expect(urlPatternMatches('https://a.example:443/*', 'https://a.example/x')).toBe(true);
    });

    await it('never match non-web URLs, and take dots literally', async () => {
      expect(urlPatternMatches('*://*/*', 'file:///etc/passwd')).toBe(false);
      expect(urlPatternMatches('*://*/*', 'about:blank')).toBe(false);
      expect(urlPatternMatches('*://*/*', undefined)).toBe(false);
      expect(urlPatternMatches('https://a.example/x.y', 'https://a.example/xzy')).toBe(false);
    });

    await it('urlsMatch: null when the matcher has no URL part', async () => {
      expect(urlsMatch({ fingerprint: [{ meta: { name: 'a' } }] }, 'https://a/')).toBe(null);
      expect(urlsMatch({ urls: ['https://a.example/*'] }, 'https://a.example/1')).toBe(true);
    });
  });
};
