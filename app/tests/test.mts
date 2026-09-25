// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite is a suite that never runs, and it looks exactly like a passing one.
import { run } from '@gjsify/unit';

import policy from './unit/core/policy.test.ts';
import protocol from './unit/core/protocol.test.ts';
import sessions from './unit/core/sessions.test.ts';
import bridge from './unit/bridge/bridge.test.ts';
import shared from './unit/bridge/shared.test.ts';
import mcpGate from './unit/mcp/gate.test.ts';
import mcpTools from './unit/mcp/tools.test.ts';

run({ policy, protocol, sessions, bridge, shared, mcpGate, mcpTools });
