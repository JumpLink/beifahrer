/**
 * Build the extension for every target — on GJS, with gjsify's own bundler. No Node, no Vite.
 *
 *   gjsify workspace beifahrer-extension build        → .output/<target>/
 *   … build --zip                                     → also .output/beifahrer-<version>-<target>.zip
 *
 * BEIFAHRER_E2E_SEED='{"token","port","policy"}' makes an E2E build instead: pre-paired, the
 * fixture hosts granted, written to .output-e2e/ and never zipped (see src/e2e-seed.ts).
 *
 * Every script is bundled ONCE as an IIFE — content scripts injected by file and an MV3 service
 * worker both need a classic script — and copied into each target; only the manifest differs.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

import { TARGETS, manifestFor } from '../manifest.ts';

// The bundle runs from extension/dist/, the source from extension/scripts/ — one level down either way.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const seed = process.env.BEIFAHRER_E2E_SEED ?? '';
const zip = process.argv.includes('--zip');
const OUT = join(ROOT, seed ? '.output-e2e' : '.output');
const STAGE = join(OUT, '.stage');

/** Scripts: output name → entry. */
const SCRIPTS: Record<string, string> = {
  background: 'entrypoints/background.ts',
  'page-agent': 'entrypoints/page-agent.ts',
  popup: 'entrypoints/popup/main.ts',
  options: 'entrypoints/options/main.ts',
  confirm: 'entrypoints/confirm/main.ts',
};
/** Pages: output name → source. Their `<script src="./main.ts">` becomes `<name>.js`. */
const PAGES: Record<string, string> = {
  popup: 'entrypoints/popup/index.html',
  options: 'entrypoints/options/index.html',
  confirm: 'entrypoints/confirm/index.html',
};

function bundle(name: string, entry: string): void {
  const args = [
    'build',
    join(ROOT, entry),
    '--app',
    'browser',
    '--format',
    'iife',
    '--define',
    `__E2E_SEED__=${JSON.stringify(seed)}`,
    '--outfile',
    join(STAGE, `${name}.js`),
  ];
  const res = spawnSync('gjsify', args, { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`gjsify build ${entry} failed (${res.status}):\n${res.stderr || res.stdout}`);
  }
}

function page(name: string, source: string): string {
  return readFileSync(join(ROOT, source), 'utf8')
    .replace(/<script type="module" src="\.\/main\.ts"><\/script>/, `<script src="${name}.js"></script>`)
    .replace(/href="(\.\.\/)+src\/ui\/style\.css"/, 'href="style.css"');
}

function e2eHosts(): string[] {
  if (!seed) return [];
  const origins = Object.keys((JSON.parse(seed) as { policy?: { origins?: object } }).policy?.origins ?? {});
  // Host only, no port — see originPattern() in src/settings.ts for why.
  return origins.map((o) => `${new URL(o).protocol}//${new URL(o).hostname}/*`);
}

/** Every file under `dir`, as zip entries relative to it. */
function collect(
  dir: string,
  into: Record<string, Uint8Array> = {},
  prefix = '',
): Record<string, Uint8Array> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, into, `${prefix}${entry.name}/`);
    else into[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path));
  }
  return into;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const [name, entry] of Object.entries(SCRIPTS)) bundle(name, entry);

for (const target of TARGETS) {
  const dir = join(OUT, target);
  mkdirSync(dir, { recursive: true });
  cpSync(STAGE, dir, { recursive: true });
  cpSync(join(ROOT, 'src/ui/style.css'), join(dir, 'style.css'));
  for (const [name, source] of Object.entries(PAGES))
    writeFileSync(join(dir, `${name}.html`), page(name, source));
  const manifest = manifestFor(target, { version: pkg.version, e2eHosts: e2eHosts() });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (zip && !seed) {
    const file = join(OUT, `beifahrer-${pkg.version}-${target}.zip`);
    writeFileSync(file, zipSync(collect(dir)));
    console.log(`zipped ${file}`);
  }
  console.log(`built ${dir}`);
}
rmSync(STAGE, { recursive: true, force: true });
// An explicit exit: the GLib main loop gjsify arms would otherwise keep the process parked.
process.exit(0);
