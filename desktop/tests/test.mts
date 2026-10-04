// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite is a suite that never runs, and it looks exactly like a passing one.
import { run } from '@gjsify/unit';

import i18n from './unit/i18n.test.ts';
import agentsModel from './unit/agents-model.test.ts';
import pairingModel from './unit/pairing-model.test.ts';
import statusModel from './unit/status-model.test.ts';

run({ agentsModel, i18n, pairingModel, statusModel });
