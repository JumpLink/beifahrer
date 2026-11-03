#!/usr/bin/env node
/**
 * The built GJS bundle answers over stdio and then EXITS. Two cases, on pipes, under a timeout:
 *
 *   1. `beifahrer --version` prints the version and exits 0.
 *   2. `beifahrer mcp` answers an `initialize`, and a closed stdin ends it with exit 0.
 *
 * Both were broken and neither unit test could see it, which is why this file exists. `cli.ts` is
 * reached through `await import('./cli.ts')` in `index.ts` (ADR 0023 — the window bundle must stay
 * unloaded), so its module body runs inside a promise job at `GLib.main_depth() === 1`. The
 * blocking `new GLib.MainLoop(null, false).run()` it used to end with starved every promise
 * continuation there: `--version` printed its line and hung forever, and `doctor` and `mcp`
 * answered NOTHING, because the yargs handler's own `process.exit()` was a continuation too.
 * `holdMainLoop()` is the cure, and this is the measurement that keeps it.
 *
 * Only the real bundle shows this: the bug lives in how the bundler lowers that dynamic import, so
 * a suite that imports the sources directly passes while the shipped artifact hangs. Hence plain
 * `node` spawning `gjsify run app/dist/gjs/beifahrer.mjs` rather than a `@gjsify/unit` suite —
 * and hence a TIMEOUT on every wait, because the failure mode under test is "never answers".
 *
 * Usage:  node tests/integration/mcp-gjs-smoke.mjs      (from `app/`, or `npm run test:mcp`)
 *
 * Needs the GJS bundle (`gjsify workspace beifahrer-app build`). Ports 47940–47944, far from the
 * person's own 47813–47822 and from the e2e range; $BEIFAHRER_MCP_SMOKE_PORT_BASE moves them.
 * The token file and `$XDG_CONFIG_HOME` go to a throw-away directory, so a run never reads or
 * writes the person's token or recipes.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The files, not the package indexes: plain Node strips types but runs no TS beyond that, and
// neither of these two pulls in anything it could not run. Asked of the app's own functions so the
// test and the app cannot drift apart — the same reason the e2e driver does it (ADR note in
// packages/local/src/config-dir.ts).
import { configDir } from '../../../packages/local/src/config-dir.ts';
import { localBin } from '../../../extension/scripts/platform.ts';
import { VERSION } from '../../src/version.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = join(ROOT, 'app/dist/gjs/beifahrer.mjs');
const PORT_BASE = Number(process.env.BEIFAHRER_MCP_SMOKE_PORT_BASE) || 47940;
const PORT_COUNT = 5;
/** Generous, because it only ever bounds a HANG: a working bundle answers in well under a second. */
const TIMEOUT_MS = Number(process.env.BEIFAHRER_MCP_SMOKE_TIMEOUT) || 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(BUNDLE)) {
  console.error(`no bundle at ${BUNDLE} — build it first: gjsify workspace beifahrer-app build`);
  process.exit(1);
}

const PROFILE = mkdtempSync(join(tmpdir(), 'beifahrer-smoke-'));
const TOKEN_FILE = join(PROFILE, 'token');
const CONFIG_HOME = join(PROFILE, 'config');
if (!configDir({ XDG_CONFIG_HOME: CONFIG_HOME }).startsWith(CONFIG_HOME)) {
  throw new Error(`the app would read its config outside the throw-away profile (${CONFIG_HOME})`);
}

const gjsify = localBin('gjsify', ROOT);

/**
 * One `beifahrer <args>` on GJS, with pipes on all three streams and a hard deadline. The returned
 * handle grows its `out`/`err` as the child writes, so a wait can look at what arrived so far.
 */
function start(args) {
  const proc = spawn(gjsify.command, ['run', BUNDLE, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: gjsify.shell,
    env: {
      ...process.env,
      BEIFAHRER_TOKEN_FILE: TOKEN_FILE,
      XDG_CONFIG_HOME: CONFIG_HOME,
    },
  });
  const handle = { proc, out: '', err: '', killed: false, done: false };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    handle.out += d;
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d) => {
    handle.err += d;
  });
  // SIGKILL, and only ever at this own child: the hang under test ignores everything politer.
  const timer = setTimeout(() => {
    handle.killed = true;
    proc.kill('SIGKILL');
  }, TIMEOUT_MS);
  handle.exit = new Promise((r) =>
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      handle.done = true;
      r(code ?? signal);
    }),
  );
  return handle;
}

/** Wait until the child's stdout satisfies `matches`, or fail saying what did arrive. */
async function waitForOutput(handle, matches, what) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (matches(handle.out)) return;
    if (handle.done) break;
    await sleep(50);
  }
  throw new Error(
    `${what}: no match after ${Date.now() > deadline ? `${TIMEOUT_MS} ms` : 'the process exited'}` +
      ` — stdout ${JSON.stringify(handle.out.slice(0, 300))}, stderr ${JSON.stringify(handle.err.slice(0, 300))}`,
  );
}

function check(ok, what) {
  if (!ok) throw new Error(what);
  console.log(`ok — ${what}`);
}

/** `--version`: the pure case. Nothing to serve, so the only thing it can get wrong is exiting. */
async function versionExits() {
  const handle = start(['--version']);
  handle.proc.stdin.end();
  const code = await handle.exit;
  check(!handle.killed, `--version exited on its own within ${TIMEOUT_MS} ms`);
  check(code === 0, `--version exit code is 0 (was ${code})`);
  check(
    handle.out.trim() === VERSION,
    `--version printed ${VERSION} (was ${JSON.stringify(handle.out.trim())})`,
  );
}

/**
 * `mcp`: the case a coding agent actually runs. One `initialize` over the stdio transport's
 * newline-delimited JSON-RPC, then EOF — which `serveUntilClosed` answers with a clean exit, so
 * an agent that goes away does not leave a bridge behind.
 */
async function mcpInitializeAndEof() {
  const handle = start(['mcp', '--port', String(PORT_BASE), '--port-count', String(PORT_COUNT)]);
  handle.proc.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'beifahrer-mcp-gjs-smoke', version: '0' },
      },
    })}\n`,
  );
  await waitForOutput(handle, (out) => out.includes('"id":1'), 'initialize');

  const answer = handle.out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((m) => m.id === 1);
  check(answer !== undefined, 'initialize was answered with one JSON-RPC message');
  check(answer.error === undefined, `initialize did not error (${JSON.stringify(answer.error)})`);
  check(
    typeof answer.result?.protocolVersion === 'string',
    `initialize named a protocol version (${answer.result?.protocolVersion})`,
  );
  check(
    answer.result?.serverInfo?.name !== undefined,
    `initialize named the server (${answer.result?.serverInfo?.name})`,
  );

  handle.proc.stdin.end();
  const code = await handle.exit;
  check(!handle.killed, `mcp exited on closed stdin within ${TIMEOUT_MS} ms`);
  check(code === 0, `mcp exit code is 0 (was ${code})`);
}

try {
  await versionExits();
  await mcpInitializeAndEof();
  console.log('mcp-gjs-smoke: all checks passed');
} finally {
  rmSync(PROFILE, { recursive: true, force: true });
}
