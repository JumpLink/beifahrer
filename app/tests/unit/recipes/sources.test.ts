import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUILTIN } from '../../../src/recipes/builtin.ts';
import { buildCatalog, loadCatalog, recipeDirs } from '../../../src/recipes/sources.ts';

function recipe(id: string, title = 'T'): Record<string, unknown> {
  return {
    id,
    title,
    description: 'd',
    version: '1.0.0',
    match: { urls: ['https://a.example/*'] },
    params: [],
    steps: [{ id: 'read', action: 'read' }],
  };
}

/** The repo's `recipes/` directory: the tests run from app/ (gjsify test) or the repo root. */
function repoRecipesDir(): string | null {
  for (const dir of [join(process.cwd(), '..', 'recipes'), join(process.cwd(), 'recipes')]) {
    if (existsSync(join(dir, 'openproject'))) return dir;
  }
  return null;
}

export default async () => {
  await describe('buildCatalog', async () => {
    await it('lets a later source replace an earlier one by id', async () => {
      const c = buildCatalog([
        [{ source: 'built-in:a.json', data: recipe('x/a', 'built-in') }],
        [{ source: '/cfg/a.json', data: recipe('x/a', 'mine') }],
      ]);
      expect(c.recipes.get('x/a')?.recipe.title).toBe('mine');
      expect(c.recipes.get('x/a')?.source).toBe('/cfg/a.json');
    });

    await it('reports an invalid file and skips it whole; it cannot shadow a valid one', async () => {
      const broken = { ...recipe('x/a', 'evil'), steps: [{ id: 's', action: 'evaluate', code: '1' }] };
      const c = buildCatalog([
        [{ source: 'built-in:a.json', data: recipe('x/a', 'good') }],
        [{ source: '/cfg/a.json', data: broken }],
      ]);
      expect(c.recipes.get('x/a')?.recipe.title).toBe('good');
      expect(c.errors.length).toBe(1);
      expect(c.errors[0]!.source).toBe('/cfg/a.json');
      expect(c.errors[0]!.reason).toMatch(/must be one of/);
    });

    await it('refuses the second of two files with the same id in ONE source', async () => {
      const c = buildCatalog([
        [
          { source: '/d/1.json', data: recipe('x/a', 'first') },
          { source: '/d/2.json', data: recipe('x/a', 'second') },
        ],
      ]);
      expect(c.recipes.get('x/a')?.recipe.title).toBe('first');
      expect(c.errors[0]!.reason).toMatch(/defined twice/);
    });
  });

  await describe('loadCatalog', async () => {
    await it('orders built-in < XDG config < BEIFAHRER_RECIPES (left to right)', async () => {
      const dirs = recipeDirs({ XDG_CONFIG_HOME: '/cfg', BEIFAHRER_RECIPES: '/one:/two:' });
      expect(dirs.map((d) => d.path).join(' ')).toBe('/cfg/beifahrer/recipes /one /two');
    });

    await it('reads files and subdirectories, reports bad JSON, oversize files and a missing named dir', async () => {
      const root = mkdtempSync(join(tmpdir(), 'beifahrer-recipes-'));
      try {
        const cfg = join(root, 'cfg');
        mkdirSync(join(cfg, 'beifahrer', 'recipes', 'acme'), { recursive: true });
        writeFileSync(
          join(cfg, 'beifahrer', 'recipes', 'acme', 'a.json'),
          JSON.stringify(recipe('acme/a', 'config')),
        );
        const team = join(root, 'team');
        mkdirSync(team);
        writeFileSync(join(team, 'a.json'), JSON.stringify(recipe('acme/a', 'team')));
        writeFileSync(join(team, 'broken.json'), '{ not json');
        writeFileSync(join(team, 'big.json'), `{"x":"${'a'.repeat(70_000)}"}`);
        writeFileSync(join(team, 'notes.txt'), 'ignored');
        const c = loadCatalog(
          { XDG_CONFIG_HOME: cfg, BEIFAHRER_RECIPES: `${team}:${join(root, 'missing')}` },
          [{ source: 'built-in:x.json', data: recipe('acme/a', 'built-in') }],
        );
        expect(c.recipes.get('acme/a')?.recipe.title).toBe('team');
        const reasons = c.errors.map((e) => `${e.source.slice(root.length)}: ${e.reason}`).join('\n');
        expect(reasons).toMatch(/\/team\/broken\.json: not valid JSON/);
        expect(reasons).toMatch(/\/team\/big\.json: larger than/);
        expect(reasons).toMatch(/\/missing: directory does not exist/);
        expect(c.errors.length).toBe(3);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    await it('a missing default config directory is not an error', async () => {
      const c = loadCatalog({ XDG_CONFIG_HOME: join(tmpdir(), 'beifahrer-does-not-exist') }, []);
      expect(c.errors.length).toBe(0);
    });
  });

  await describe('built-in recipes', async () => {
    await it('builtin.ts lists every file in recipes/', async () => {
      const dir = repoRecipesDir();
      if (!dir) throw new Error(`recipes/ not found from ${process.cwd()}`);
      const files: string[] = [];
      for (const app of readdirSync(dir)) {
        if (!existsSync(join(dir, app)) || app.includes('.')) continue;
        for (const f of readdirSync(join(dir, app)))
          if (f.endsWith('.json')) files.push(`built-in:${app}/${f}`);
      }
      expect(
        BUILTIN.map((b) => b.source)
          .sort()
          .join(' '),
      ).toBe(files.sort().join(' '));
    });
  });
};
