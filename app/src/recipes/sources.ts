/**
 * Where recipes come from, and which one wins.
 *
 * Three sources, loaded in this order; a later one replaces an earlier one with the same id:
 *   1. built-in: `recipes/` of this repository, bundled into the app at build time (builtin.ts);
 *   2. `$XDG_CONFIG_HOME/beifahrer/recipes/` (default `~/.config/…`): the person's own;
 *   3. every directory in `$BEIFAHRER_RECIPES` (colon-separated, left to right): the most explicit,
 *      e.g. a team's shared checkout.
 *
 * Company-specific recipes (a customer's domain, an internal process) belong in 2 or 3, never in
 * the public repo.
 *
 * A file that is not a valid recipe is REPORTED and skipped as a whole — never half-loaded, and
 * never able to shadow a valid recipe of the same id from an earlier source (it has no id we can
 * trust). Recipes are read fresh on every tool call, so an edited file needs no restart.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_RECIPE_BYTES, parseRecipe, type Recipe } from '@beifahrer/core';

import { BUILTIN } from './builtin.ts';

export interface LoadedRecipe {
  recipe: Recipe;
  /** `built-in:<file>` or the file's path. */
  source: string;
}

export interface RecipeCatalog {
  recipes: Map<string, LoadedRecipe>;
  /** Files that were refused, and why. */
  errors: { source: string; reason: string }[];
  /** The directories that were looked in, in load order. */
  dirs: string[];
}

export interface RecipeFile {
  source: string;
  data: unknown;
}

/** The recipe directories, in load order (later wins). */
export function recipeDirs(env: NodeJS.ProcessEnv = process.env): { path: string; explicit: boolean }[] {
  const config = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dirs = [{ path: join(config, 'beifahrer', 'recipes'), explicit: false }];
  for (const dir of (env.BEIFAHRER_RECIPES ?? '').split(':')) {
    if (dir.trim()) dirs.push({ path: dir.trim(), explicit: true });
  }
  return dirs;
}

/** `*.json` files of a directory and its direct subdirectories (`openproject/add-comment.json`), sorted. */
function jsonFiles(dir: string, depth = 0): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (depth < 1) out.push(...jsonFiles(path, depth + 1));
    } else if (entry.endsWith('.json')) out.push(path);
  }
  return out;
}

function readDir(dir: string, explicit: boolean, errors: RecipeCatalog['errors']): RecipeFile[] {
  if (!existsSync(dir)) {
    // The default config directory need not exist. One the person named explicitly must.
    if (explicit) errors.push({ source: dir, reason: 'directory does not exist' });
    return [];
  }
  let files: string[];
  try {
    files = jsonFiles(dir);
  } catch (err) {
    errors.push({ source: dir, reason: `cannot read: ${(err as Error).message}` });
    return [];
  }
  const out: RecipeFile[] = [];
  for (const path of files) {
    try {
      if (statSync(path).size > MAX_RECIPE_BYTES) {
        errors.push({ source: path, reason: `larger than ${MAX_RECIPE_BYTES} bytes` });
        continue;
      }
      out.push({ source: path, data: JSON.parse(readFileSync(path, 'utf8')) });
    } catch (err) {
      errors.push({ source: path, reason: `not valid JSON: ${(err as Error).message}` });
    }
  }
  return out;
}

/**
 * Build the catalogue from groups of files, in precedence order. Pure apart from its input, so the
 * override and refusal rules are unit-tested without a file system.
 */
export function buildCatalog(groups: RecipeFile[][], dirs: string[] = []): RecipeCatalog {
  const catalog: RecipeCatalog = { recipes: new Map(), errors: [], dirs };
  for (const files of groups) {
    const seen = new Set<string>();
    for (const file of files) {
      const recipe = parseRecipe(file.data);
      if (typeof recipe === 'string') {
        catalog.errors.push({ source: file.source, reason: recipe });
        continue;
      }
      // Two files of ONE source with the same id: which was meant is a guess, so the second is
      // refused rather than silently picked by file-name order.
      if (seen.has(recipe.id)) {
        catalog.errors.push({ source: file.source, reason: `${recipe.id} is defined twice in this source` });
        continue;
      }
      seen.add(recipe.id);
      catalog.recipes.set(recipe.id, { recipe, source: file.source });
    }
  }
  return catalog;
}

export function loadCatalog(
  env: NodeJS.ProcessEnv = process.env,
  builtin: RecipeFile[] = BUILTIN,
): RecipeCatalog {
  const errors: RecipeCatalog['errors'] = [];
  const dirs = recipeDirs(env);
  const groups = [builtin, ...dirs.map((d) => readDir(d.path, d.explicit, errors))];
  const catalog = buildCatalog(
    groups,
    dirs.map((d) => d.path),
  );
  catalog.errors.unshift(...errors);
  return catalog;
}
