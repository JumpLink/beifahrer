#!/usr/bin/env node
/**
 * Composes the product pictures this repository publishes: a REAL screenshot of one of the
 * extension's own pages, shown inside a fictional browser frame, with the REAL desktop window
 * standing beside it.
 *
 *   node tools/compose-shots.mjs hero  [--lang en|de] [--scheme light|dark] [--out <path>]
 *   node tools/compose-shots.mjs frame [--lang en|de] [--scheme light|dark] [--out <path>]
 *
 * `hero` writes `docs/images/hero-<scheme>.png` (German: `hero-de-<scheme>.png`, the naming the
 * other docs images already use). `frame` writes the empty frame on its own, which is how the
 * frame itself is looked at without a screenshot distracting from it.
 *
 * NOTHING HERE IS A DRAWING OF THE PRODUCT. The page inside the frame is `docs/images/options-*`
 * exactly as the e2e wrote it (`tests/e2e/ui-pages.mjs`), and the window beside it is
 * `tools/compose/app-<scheme>.png`, captured from the running libadwaita app with the werkstatt
 * helper, synthetic registry entry and all:
 *
 *   XDG_CONFIG_HOME=$S/config BEIFAHRER_REGISTRY_DIR=$S/registry BEIFAHRER_PORT=47951 \
 *     headless-run --size 1600x1600 --scale 2 --shot-delay 8 --window-shot $S/app-light.png \
 *     -- node_modules/.bin/gjsify run app/dist/gjs/window.mjs
 *
 * The capture is committed rather than taken here, because it needs a Wayland compositor and a
 * script that lives outside this repository; this renderer needs neither and runs anywhere the
 * e2e's Chromium runs. Only the frame around the two is CSS, and the frame is DELIBERATELY NOT
 * any shipping browser (see `tools/compose/frame.html`).
 *
 * REPRODUCIBLE: two runs write the same bytes. Every image is inlined as a data URI, so the page
 * fetches nothing; no date, no random value and no host path reaches the document; the profile is
 * thrown away before each run; and the shot is taken at a fixed device scale by the same Chromium
 * the e2e uses (`extension/scripts/platform.ts`).
 *
 * The browser frame is a GJSIFY CANDIDATE, not yet a port: the moment a second app wants to show a
 * screenshot inside a browser, `tools/compose/` moves to gjsify and both apps take it from there.
 * Until then it stays here — a shared package with one consumer is a guess about the second one.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromiumBinary } from '../extension/scripts/platform.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = join(ROOT, 'tools/compose');
/** Scratch, never `/tmp`: the profile is this machine's, and `/tmp` is shared. */
const SCRATCH = join(homedir(), '.cache/beifahrer-compose');
/** Above the app's own range (47951+) and above the e2e's (47900+), so no run answers for another. */
const DEVTOOLS_PORT = 47971;
/** The store format every listing asks for, at 2× for the docs page. */
const CANVAS = { width: 1280, height: 800, scale: 2 };

const SHOTS = ['hero', 'frame'];
const LANGS = ['en', 'de'];
const SCHEMES = ['light', 'dark'];

const read = (file) => readFileSync(join(PARTS, file), 'utf8');
/** Templates and fragments carry an HTML comment for the reader; it is not part of the picture. */
const body = (file) => read(file).replace(/^<!--[\s\S]*?-->\s*/, '');
const fill = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in values ? values[key] : match));

function dataUri(path) {
  if (!existsSync(path)) throw new Error(`missing picture: ${path}`);
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

/** The toolbar mark as the extension ships it, without its XML header or its comment. */
function toolbarIcon() {
  const file = join(ROOT, 'data/icons/toolbar/eu.jumplink.beifahrer-toolbar-symbolic.svg');
  return readFileSync(file, 'utf8')
    .replace(/<\?xml[\s\S]*?\?>\s*/, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trim();
}

function parseArgs(argv) {
  const [shot, ...rest] = argv;
  if (!SHOTS.includes(shot)) {
    throw new Error(
      `usage: compose-shots.mjs <${SHOTS.join('|')}> [--lang en|de] [--scheme light|dark] [--out <path>]`,
    );
  }
  const options = { shot, lang: 'en', scheme: 'light', out: null };
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${rest[i]} needs a value`);
    if (rest[i] === '--lang') options.lang = value;
    else if (rest[i] === '--scheme') options.scheme = value;
    else if (rest[i] === '--out') options.out = resolve(value);
    else throw new Error(`unknown option: ${rest[i]}`);
  }
  if (!LANGS.includes(options.lang)) throw new Error(`--lang is one of ${LANGS.join(', ')}`);
  if (!SCHEMES.includes(options.scheme)) throw new Error(`--scheme is one of ${SCHEMES.join(', ')}`);
  return options;
}

/** `hero-light.png`, `hero-de-dark.png`: English is the unmarked case, as elsewhere in docs/images. */
function defaultOut({ shot, lang, scheme }) {
  const name = `${shot}${lang === 'en' ? '' : `-${lang}`}-${scheme}.png`;
  return shot === 'hero' ? join(ROOT, 'docs/images', name) : join(SCRATCH, name);
}

function document_({ shot, lang, scheme }) {
  const strings = JSON.parse(read(`strings.${lang}.json`));
  const frame = fill(body('frame.html'), {
    ...strings,
    toolbar_icon: toolbarIcon(),
    page:
      shot === 'hero'
        ? `<img class="shot" src="${dataUri(join(ROOT, `docs/images/options${lang === 'en' ? '' : `-${lang}`}-${scheme}.png`))}" alt="" />`
        : '',
  });
  const content =
    shot === 'hero'
      ? fill(body('hero.html'), {
          ...strings,
          frame,
          app_src: dataUri(join(PARTS, `app-${scheme}.png`)),
        })
      : `<div class="hero"><section class="hero__browser">${frame}</section></div>`;
  return fill(read('shell.html'), {
    lang,
    scheme: scheme === 'dark' ? 'dark' : '',
    title: strings.tab_title,
    css: read('compose.css'),
    body: content,
  });
}

/** One DevTools connection, shaped like the e2e's (`tests/e2e/ui-pages.mjs`). */
function rpc(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((done) => {
      const id = ++n;
      pending.set(id, done);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((done, fail) => {
    ws.onopen = () => done({ send, close: () => ws.close() });
    ws.onerror = fail;
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function firstPage(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not listening yet */
    }
    await sleep(100);
  }
  throw new Error(`no DevTools page on 127.0.0.1:${port} within 10 s`);
}

/** Everything the picture needs to have settled before the shutter: fonts, images, two frames. */
const SETTLED = `(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return 'ok';
})()`;

async function render(html, out) {
  const binary = chromiumBinary();
  if (!binary) throw new Error('no Chromium — set BEIFAHRER_E2E_CHROMIUM');
  const profile = join(SCRATCH, 'chromium-profile');
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const browser = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${DEVTOOLS_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      // Same pixels on every host: no colour management of its own, no subpixel antialiasing, no
      // hinting that follows the desktop's font settings.
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const page = await firstPage(DEVTOOLS_PORT);
    const client = await rpc(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: CANVAS.width,
      height: CANVAS.height,
      deviceScaleFactor: CANVAS.scale,
      mobile: false,
    });
    const tree = await client.send('Page.getFrameTree');
    await client.send('Page.setDocumentContent', { frameId: tree.result.frameTree.frame.id, html });
    await client.send('Runtime.evaluate', { expression: SETTLED, awaitPromise: true, returnByValue: true });
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height, scale: 1 },
    });
    client.close();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  } finally {
    browser.kill('SIGTERM');
  }
}

const options = parseArgs(process.argv.slice(2));
const out = options.out ?? defaultOut(options);
mkdirSync(SCRATCH, { recursive: true });
await render(document_(options), out);
console.log(`${out} (${CANVAS.width * CANVAS.scale}x${CANVAS.height * CANVAS.scale})`);
