/**
 * The recipes shipped with beifahrer: `recipes/` at the repository root, bundled into the app at
 * build time so that an installed bundle carries them without a checkout next to it.
 *
 * One import per file. Adding a recipe file means adding it here too; the unit test
 * `builtin recipes` compares this list against the directory and fails on a file left out.
 */

import aokDownloadAttachment from '../../../recipes/aok/download-attachment.json' with { type: 'json' };
import aokLogin from '../../../recipes/aok/login.json' with { type: 'json' };
import aokListPostbox from '../../../recipes/aok/list-postbox.json' with { type: 'json' };
import atruviaDownloadDocument from '../../../recipes/atruvia/download-document.json' with { type: 'json' };
import atruviaLogin from '../../../recipes/atruvia/login.json' with { type: 'json' };
import atruviaListPostbox from '../../../recipes/atruvia/list-postbox.json' with { type: 'json' };
import openprojectAddComment from '../../../recipes/openproject/add-comment.json' with { type: 'json' };
import openprojectEditDescription from '../../../recipes/openproject/edit-description.json' with { type: 'json' };

import type { RecipeFile } from './sources.ts';

export const BUILTIN: RecipeFile[] = [
  { source: 'built-in:aok/download-attachment.json', data: aokDownloadAttachment },
  { source: 'built-in:aok/login.json', data: aokLogin },
  { source: 'built-in:aok/list-postbox.json', data: aokListPostbox },
  { source: 'built-in:atruvia/download-document.json', data: atruviaDownloadDocument },
  { source: 'built-in:atruvia/login.json', data: atruviaLogin },
  { source: 'built-in:atruvia/list-postbox.json', data: atruviaListPostbox },
  { source: 'built-in:openproject/add-comment.json', data: openprojectAddComment },
  { source: 'built-in:openproject/edit-description.json', data: openprojectEditDescription },
];
