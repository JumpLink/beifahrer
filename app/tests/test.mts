// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite is a suite that never runs, and it looks exactly like a passing one.
import { run } from '@gjsify/unit';

import features from './unit/core/features.test.ts';
import browserFamily from './unit/core/browser-family.test.ts';
import accessCheck from './unit/core/access-check.test.ts';
import find from './unit/core/find.test.ts';
import recipes from './unit/core/recipes.test.ts';
import policy from './unit/core/policy.test.ts';
import protocol from './unit/core/protocol.test.ts';
import ports from './unit/core/ports.test.ts';
import connections from './unit/core/connections.test.ts';
import sessions from './unit/core/sessions.test.ts';
import desktop from './unit/core/desktop.test.ts';
import download from './unit/core/download.test.ts';
import evaluate from './unit/core/evaluate.test.ts';
import keys from './unit/core/keys.test.ts';
import chunks from './unit/core/chunks.test.ts';
import expectRules from './unit/core/expect.test.ts';
import networkRules from './unit/core/network.test.ts';
import navigate from './unit/core/navigate.test.ts';
import refs from './unit/core/refs.test.ts';
import toolbar from './unit/core/toolbar.test.ts';
import shortcut from './unit/core/shortcut.test.ts';
import registry from './unit/core/registry.test.ts';
import bridge from './unit/bridge/bridge.test.ts';
import configDir from './unit/bridge/config-dir.test.ts';
import bridgeDesktop from './unit/bridge/desktop.test.ts';
import extensionManifest from './unit/extension/manifest.test.ts';
import extensionStatus from './unit/extension/status.test.ts';
import updatesJson from './unit/extension/updates-json.test.ts';
import mcpGate from './unit/mcp/gate.test.ts';
import mcpTools from './unit/mcp/tools.test.ts';
import mcpOutput from './unit/mcp/output.test.ts';
import recipeRunner from './unit/recipes/runner.test.ts';
import recipeSources from './unit/recipes/sources.test.ts';
import localPairing from './unit/local/pairing.test.ts';
import localPortProbe from './unit/local/port-probe.test.ts';
import registryDir from './unit/registry/registry-dir.test.ts';
import registryStore from './unit/registry/store.test.ts';
import registryPublisher from './unit/registry/publisher.test.ts';
import statusCommand from './unit/registry/status.test.ts';

run({
  features,
  browserFamily,
  accessCheck,
  find,
  recipes,
  policy,
  protocol,
  ports,
  connections,
  sessions,
  desktop,
  download,
  evaluate,
  keys,
  chunks,
  expectRules,
  networkRules,
  navigate,
  refs,
  toolbar,
  shortcut,
  registry,
  bridge,
  bridgeDesktop,
  configDir,
  extensionManifest,
  extensionStatus,
  updatesJson,
  mcpGate,
  mcpTools,
  mcpOutput,
  recipeRunner,
  recipeSources,
  localPairing,
  localPortProbe,
  registryDir,
  registryStore,
  registryPublisher,
  statusCommand,
});
