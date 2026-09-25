/**
 * Recipe tools: list the recipes, find the ones that fit a tab, run one.
 *
 * A run is a macro over the ordinary protocol calls (recipes/runner.ts): the extension checks
 * every step like any single call. This file adds no gate and removes none.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Recipe } from '@beifahrer/core';

import { runRecipe, TabProbe } from '../../recipes/runner.ts';
import { loadCatalog, type RecipeCatalog } from '../../recipes/sources.ts';
import { browserParam, failure, text, type Call } from './tools.ts';

export interface RecipeToolOptions {
  /** Injected by tests; the real server reads the catalogue fresh on every call. */
  catalog?: () => RecipeCatalog;
}

function summary(recipe: Recipe, source: string) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    version: recipe.version,
    source,
    params: recipe.params,
    steps: recipe.steps.map(
      (s) =>
        `${s.id} (${s.action}${s.requiresExplicitRequest ? ", only on the person's explicit request" : ''})`,
    ),
  };
}

export function registerRecipeTools(server: McpServer, call: Call, opts: RecipeToolOptions = {}): void {
  const catalog = opts.catalog ?? (() => loadCatalog());

  server.registerTool(
    'recipes_list',
    {
      title: 'Recipes: ready-made steps for tasks on known web apps',
      description:
        'Every recipe beifahrer knows — site-specific tasks like "add a comment to an OpenProject work package", written as data — with where each was loaded from, ' +
        'and any recipe files that were refused and why. Use recipes_for_tab to see which fit a tab.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const c = catalog();
        return text({
          recipes: [...c.recipes.values()].map((r) => summary(r.recipe, r.source)),
          directories: c.dirs,
          refused: c.errors,
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'recipes_for_tab',
    {
      title: 'Recipes that fit a tab',
      description:
        'The recipes whose match fits this tab (by URL pattern and/or by looking at the page, e.g. "is this OpenProject?"), with their params. ' +
        'Needs level "read" on the site — checking a page means reading it. A "forbidden" error is the person\'s decision, not a malfunction.',
      inputSchema: { tabId: z.number().int(), browser: browserParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ tabId, browser }) => {
      try {
        const probe = await TabProbe.open(call, tabId, browser);
        if (!probe.url)
          return text({
            tabId,
            recipes: [],
            note: 'this tab is on a site below level "read" in beifahrer, so no recipe can look at it',
          });
        const fits = [];
        for (const { recipe, source } of catalog().recipes.values()) {
          if (await probe.matches(recipe)) fits.push(summary(recipe, source));
        }
        return text({ tabId, recipes: fits });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'recipe_run',
    {
      title: 'Run a recipe on a tab',
      description:
        'Runs a recipe step by step on a tab and returns the log. Each step is an ordinary beifahrer call, checked by the browser like one you made yourself: ' +
        'writes need level "read + edit" and the person may be asked to confirm each one. Stops at the first failing step and names it. ' +
        'A step that publishes (posting a comment, saving) runs ONLY with explicitRequest: true, and you may set that ONLY when the person asked for exactly that action ' +
        '(e.g. "post this comment"). Otherwise the run stops before it and the draft stays on the page for the person to review; continue later with from: <that step>. ' +
        'A "forbidden" or "denied" error is the person\'s decision, not a malfunction.',
      inputSchema: {
        tabId: z.number().int(),
        id: z.string().describe('Recipe id from recipes_for_tab, e.g. openproject/add-comment'),
        params: z.record(z.string(), z.string()).optional().describe("The recipe's params by name"),
        from: z.string().optional().describe('Start at this step id (resume after a stop)'),
        until: z.string().optional().describe('Stop before this step id'),
        explicitRequest: z
          .boolean()
          .optional()
          .describe('true ONLY when the person asked for exactly the action of the final step (post / save)'),
        browser: browserParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ tabId, id, params, from, until, explicitRequest, browser }) => {
      try {
        const loaded = catalog().recipes.get(id);
        if (!loaded) return failure(new Error(`no recipe "${id}" — recipes_list shows the known ones`));
        const run = await runRecipe(call, loaded.recipe, {
          tabId,
          params,
          from,
          until,
          explicitRequest,
          browser,
        });
        const res = text(run);
        return run.status === 'failed' ? { ...res, isError: true } : res;
      } catch (err) {
        return failure(err);
      }
    },
  );
}
