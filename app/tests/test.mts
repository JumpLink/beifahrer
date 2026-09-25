// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite is a suite that never runs, and it looks exactly like a passing one.
import { run } from '@gjsify/unit';

import features from './unit/core/features.test.ts';
import find from './unit/core/find.test.ts';
import recipes from './unit/core/recipes.test.ts';
import policy from './unit/core/policy.test.ts';
import protocol from './unit/core/protocol.test.ts';
import sessions from './unit/core/sessions.test.ts';
import bridge from './unit/bridge/bridge.test.ts';
import shared from './unit/bridge/shared.test.ts';
import mcpGate from './unit/mcp/gate.test.ts';
import mcpTools from './unit/mcp/tools.test.ts';
import recipeRunner from './unit/recipes/runner.test.ts';
import recipeSources from './unit/recipes/sources.test.ts';

run({
  features,
  find,
  recipes,
  policy,
  protocol,
  sessions,
  bridge,
  shared,
  mcpGate,
  mcpTools,
  recipeRunner,
  recipeSources,
});
