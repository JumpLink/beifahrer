/**
 * Build the extension for every target — on GJS, with gjsify's own bundler. No Node, no Vite.
 *
 *   gjsify workspace beifahrer-extension build        → .output/<target>/
 *   … build --zip                                     → also .output/beifahrer-<version>-<target>.zip
 *
 * BEIFAHRER_E2E_SEED='{"token","port","policy","e2eAllUrls"}' makes an E2E build instead: pre-paired,
 * the fixture hosts granted, written to .output-e2e/ and never zipped (see src/e2e-seed.ts).
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
import { copyIcons, renderIcons } from './icons.ts';
import { checkLocales, sourceFiles } from './locales.ts';
import { localBin } from './platform.ts';

// The bundle runs from extension/dist/, the source from extension/scripts/ — one level down either way.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const seed = process.env.BEIFAHRER_E2E_SEED ?? '';
const zip = process.argv.includes('--zip');
// BEIFAHRER_OUT_DIR: `dev` builds into its own directory and rebuilds IN PLACE (see below).
const OUT = process.env.BEIFAHRER_OUT_DIR
  ? resolve(ROOT, process.env.BEIFAHRER_OUT_DIR)
  : join(ROOT, seed ? '.output-e2e' : '.output');
const inPlace = Boolean(process.env.BEIFAHRER_OUT_DIR);
const STAGE = join(OUT, '.stage');

/** Scripts: output name → entry. */
const SCRIPTS: Record<string, string> = {
  background: 'entrypoints/background.ts',
  'page-agent': 'entrypoints/page-agent.ts',
  popup: 'entrypoints/popup/main.ts',
  options: 'entrypoints/options/main.ts',
  confirm: 'entrypoints/confirm/main.ts',
  // Translation + the Adwaita elements, shared by the three pages (src/ui/kit.ts, ADR 0008).
  ui: 'src/ui/kit.ts',
};
/**
 * Pages: output name → source. Their `<script src="./main.ts">` becomes `<name>.js`, and the
 * shared `src/ui/kit.ts` becomes `ui.js`: two classic scripts, run in document order.
 */
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
  // The bare name build.ts has always spawned (PATH), not a repo-local path: `gjsify` here is
  // whatever CLI is running this script. On Windows that file is `gjsify.cmd`, which Node cannot
  // execute without a shell.
  const gjsify = localBin('gjsify');
  const res = spawnSync(gjsify.command, args, { cwd: ROOT, encoding: 'utf8', shell: gjsify.shell });
  if (res.status !== 0) {
    throw new Error(`gjsify build ${entry} failed (${res.status}):\n${res.stderr || res.stdout}`);
  }
}

function page(name: string, source: string): string {
  return readFileSync(join(ROOT, source), 'utf8')
    .replace(/<script src="(\.\.\/)+src\/ui\/kit\.ts"><\/script>/, '<script src="ui.js"></script>')
    .replace(/<script type="module" src="\.\/main\.ts"><\/script>/, `<script src="${name}.js"></script>`)
    .replace(/href="(\.\.\/)+src\/ui\/style\.css"/, 'href="style.css"');
}

const ALL_URLS = '<all_urls>';

/** The seed an E2E build carries (see the header), parsed once per question asked of it. */
type E2eSeed = {
  policy?: { origins?: object };
  e2eHostOrigins?: string[];
  e2eApiPermissions?: string[];
  /**
   * `e2eAllUrls`: `<all_urls>` in the manifest, which no per-origin pattern can stand in for —
   * Chromium's `captureVisibleTab` accepts nothing narrower and Firefox does not even define it
   * without (AGENTS.md "Traps already paid for"). The person asks for it in the same click as the
   * Screenshots switch; a headless test cannot press Allow on the browser's bubble, so the build
   * carries it. The build that proves the REFUSAL is the one that does not set this.
   */
  e2eAllUrls?: boolean;
};
const e2eSeed = (): E2eSeed | null => (seed ? (JSON.parse(seed) as E2eSeed) : null);

/** API permissions an E2E build is given up front; a test cannot click a permission prompt. */
function e2eApiPermissions(): string[] {
  const parsed = e2eSeed();
  if (!parsed) return [];
  const perms = [...(parsed.e2eApiPermissions ?? [])];
  return parsed.e2eAllUrls && !perms.includes(ALL_URLS) ? [...perms, ALL_URLS] : perms;
}

function e2eHosts(): string[] {
  const parsed = e2eSeed();
  if (!parsed) return [];
  // `e2eHostOrigins`: sites the test reaches through a temporary grant or a prompt's answer
  // (ADR 0010), whose browser prompt it cannot click either.
  const origins = [...Object.keys(parsed.policy?.origins ?? {}), ...(parsed.e2eHostOrigins ?? [])];
  // Host only, no port — see originPattern() in src/settings.ts for why.
  const hosts = origins.map((o) => `${new URL(o).protocol}//${new URL(o).hostname}/*`);
  // `<all_urls>` lands on BOTH lists: which one a target reads is the target's business
  // (manifest.ts — `host_permissions` on MV3, `permissions` on MV2), and a seed that put it on one
  // side only would build a manifest that asks for what it does not grant.
  return parsed.e2eAllUrls && !hosts.includes(ALL_URLS) ? [...hosts, ALL_URLS] : hosts;
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

// A dev build must not delete the directory `web-ext run` is watching: Firefox would unload the
// extension mid-rebuild. It overwrites file by file instead; a release build starts clean.
// A missing or stray translation fails the build before anything is bundled.
const localeErrors = checkLocales(ROOT, {
  pages: Object.values(PAGES),
  code: [...sourceFiles(ROOT, 'src'), ...sourceFiles(ROOT, 'entrypoints')],
  manifest: TARGETS.map((target) => JSON.stringify(manifestFor(target, { version: pkg.version }))).join('\n'),
});
if (localeErrors.length) throw new Error(`_locales is inconsistent:\n  ${localeErrors.join('\n  ')}`);

// Nothing the browser loads is touched before every bundle has built: a failed build must leave
// the last good extension in place (a browser reloading an empty folder shows only a
// file-not-found). Each target folder is replaced below, once the stage is complete.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const [name, entry] of Object.entries(SCRIPTS)) bundle(name, entry);
const ICON_STAGE = join(OUT, '.icons');
renderIcons(ROOT, ICON_STAGE);

for (const target of TARGETS) {
  const dir = join(OUT, target);
  if (!inPlace) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(STAGE, dir, { recursive: true });
  copyIcons(ICON_STAGE, dir, target);
  cpSync(join(ROOT, 'src/ui/style.css'), join(dir, 'style.css'));
  cpSync(join(ROOT, '_locales'), join(dir, '_locales'), { recursive: true });
  for (const [name, source] of Object.entries(PAGES))
    writeFileSync(join(dir, `${name}.html`), page(name, source));
  const manifest = manifestFor(target, {
    version: pkg.version,
    e2eHosts: e2eHosts(),
    e2eApiPermissions: e2eApiPermissions(),
  });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (zip && !seed) {
    const file = join(OUT, `beifahrer-${pkg.version}-${target}.zip`);
    writeFileSync(file, zipSync(collect(dir)));
    console.log(`zipped ${file}`);
  }
  console.log(`built ${dir}`);
}
rmSync(STAGE, { recursive: true, force: true });
rmSync(ICON_STAGE, { recursive: true, force: true });
// An explicit exit: the GLib main loop gjsify arms would otherwise keep the process parked.
process.exit(0);
