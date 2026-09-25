/**
 * `gjsify workspace beifahrer-extension dev` — the edit/reload loop.
 *
 *   1. build once into .output-dev/, pre-paired with the local token on the DEV port;
 *   2. start the browser with the extension (`web-ext run`), in a persistent dev profile;
 *   3. watch the sources and rebuild in place — web-ext notices and reloads the extension.
 *
 * The dev browser talks to port 47814 (BEIFAHRER_DEV_PORT), not the everyday 47813: the person's
 * real Firefox is paired to the hub there, and a second browser on the same hub would make every
 * agent call without `browser` ambiguous. Talk to the dev browser with
 * `gjsify run app/dist/beifahrer.gjs.mjs call <method> --port 47814`, or an MCP server started
 * with BEIFAHRER_PORT=47814.
 *
 *   --chromium    Chromium instead of Firefox (needs BEIFAHRER_E2E_CHROMIUM or Playwright's build)
 *   --headless    no window (used to test this script itself)
 *
 * web-ext is a Node tool; it moves to `gjsify exec` once gjsify runs Node bins on GJS.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '.output-dev';
const PORT = Number(process.env.BEIFAHRER_DEV_PORT) || 47814;
const chromium = process.argv.includes('--chromium');
const headless = process.argv.includes('--headless');
const WATCH = ['entrypoints', 'src', 'icons', 'manifest.ts', '../packages/core/src'].map((p) =>
  join(ROOT, p),
);

function token(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const file = process.env.BEIFAHRER_TOKEN_FILE || join(base, 'beifahrer', 'token');
  if (!existsSync(file)) {
    console.error(`no pairing token at ${file} — run \`gjsify run app/dist/beifahrer.gjs.mjs token\` first`);
    return process.exit(2);
  }
  return readFileSync(file, 'utf8').trim();
}

const env = {
  ...process.env,
  BEIFAHRER_OUT_DIR: OUT_DIR,
  // The same pre-pairing an E2E build uses (src/e2e-seed.ts): token + port, no site grants.
  BEIFAHRER_E2E_SEED: JSON.stringify({ token: token(), port: PORT }),
};

function build(): boolean {
  const started = Date.now();
  const res = spawnSync('gjsify', ['run', join(ROOT, 'dist/build.gjs.mjs')], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error(`✖ build failed:\n${res.stderr || res.stdout}`);
    return false;
  }
  console.log(`✔ built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return true;
}

/** Newest mtime under the watched paths. Polling: portable across GJS and Node, cheap at this size. */
function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const entry of readdirSync(path)) max = Math.max(max, newest(join(path, entry)));
  return max;
}
const stamp = () => Math.max(...WATCH.map(newest));

function chromiumBinary(): string | undefined {
  if (process.env.BEIFAHRER_E2E_CHROMIUM) return process.env.BEIFAHRER_E2E_CHROMIUM;
  const base = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const d of dirs) {
    const bin = join(base, d, 'chrome-linux64', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

function launch(): ChildProcess {
  const target = chromium ? 'chrome-mv3' : 'firefox-mv2';
  const profile = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'beifahrer', `dev-${target}`);
  // web-ext creates the profile directory, but not its parent (ENOENT on a fresh machine).
  mkdirSync(dirname(profile), { recursive: true });
  const args = ['run', '--source-dir', join(ROOT, OUT_DIR, target), '--no-input'];
  if (chromium) {
    const bin = chromiumBinary();
    if (!bin) {
      console.error('no Chromium that loads unpacked extensions — set BEIFAHRER_E2E_CHROMIUM');
      return process.exit(2);
    }
    args.push('--target', 'chromium', '--chromium-binary', bin, '--chromium-profile', profile);
  } else {
    args.push('--firefox-profile', profile, '--keep-profile-changes');
    if (headless) args.push('--arg=-headless');
  }
  if (chromium && headless) args.push('--arg=--headless=new');
  args.push('--profile-create-if-missing');
  console.log(
    `▶ ${chromium ? 'Chromium' : 'Firefox'} with the dev build (profile ${profile}, bridge port ${PORT})`,
  );
  return spawn(join(ROOT, '../node_modules/.bin/web-ext'), args, { cwd: ROOT, stdio: 'inherit' });
}

if (!build()) process.exit(1);
const browser = launch();
browser.on('exit', (code) => {
  console.log(`browser closed (${code ?? 0}) — stopping`);
  process.exit(0);
});

let last = stamp();
let busy = false;
setInterval(() => {
  if (busy) return;
  const now = stamp();
  if (now === last) return;
  last = now;
  busy = true;
  console.log('↻ change detected, rebuilding…');
  build();
  busy = false;
}, 700);
