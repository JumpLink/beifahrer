/**
 * The recipes shipped with beifahrer: `recipes/` at the repository root, bundled into the app at
 * build time so that an installed bundle carries them without a checkout next to it.
 *
 * One import per file. Adding a recipe file means adding it here too; the unit test
 * `builtin recipes` compares this list against the directory and fails on a file left out.
 */

import openprojectAddComment from '../../../recipes/openproject/add-comment.json' with { type: 'json' };
import openprojectEditDescription from '../../../recipes/openproject/edit-description.json' with { type: 'json' };

import type { RecipeFile } from './sources.ts';

export const BUILTIN: RecipeFile[] = [
  { source: 'built-in:openproject/add-comment.json', data: openprojectAddComment },
  { source: 'built-in:openproject/edit-description.json', data: openprojectEditDescription },
];
