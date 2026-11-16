#!/usr/bin/env node
/**
 * Composes the product pictures from the REAL captures this repository already produces.
 *
 *   tests/e2e/ui-pages.mjs   ──▶  docs/images/options-*.png   (the extension's own pages)
 *   tools/desktop-shots.sh   ──▶  docs/images/desktop-*.png   (the native window, headless)
 *                                       │
 *                            this script ──▶  docs/images/frame-light.png, hero-light.png
 *
 * Nothing in the output is drawn by hand or by a generator: the captures go in as the files they
 * are, unretouched and never enlarged, and only the browser around them is CSS (tools/compose/).
 * That browser is FICTIONAL and neutral — no real product's chrome, logo, name or vendor mark
 * anywhere in the markup (plan § "Decided 2026-11-16", item 6). The one mark in it is Beifahrer's
 * own icon.
 *
 * Composed pictures go on the WEBSITE only. They never enter `data/*.metainfo.xml`: a metainfo
 * screenshot is a rendition of the app, and a frame drawn around it is marketing (plan § Decision 2).
 *
 * Usage:  node tools/compose-shots.mjs [frame|hero|all] [--out DIR] [--keep-browser]
 *         node tools/compose-shots.mjs --help
 *
 * Output is 1280 × 800 CSS px at deviceScaleFactor 2 → 2560 × 1600, the store size at 2×, so
 * nothing has to be re-composed for a store later.
 *
 * REPRODUCIBLE, and checked rather than hoped for: two runs must write the same bytes.
 *
 *     node tools/compose-shots.mjs all && sha256sum docs/images/hero-light.png
 *     node tools/compose-shots.mjs all && sha256sum docs/images/hero-light.png
 *
 * Everything that could differ between two runs is pinned: no animation or transition (frame.css),
 * no `prefers-color-scheme` query, a fixed colour profile and text rendering on the command line
 * below, and the capture waits on a SIGNAL the page sets once its fonts and images are decoded
 * (`documentElement.dataset.ready`), never on a sleep.
 *
 * Needs the same Chromium the e2e needs — Chrome for Testing / Playwright's build, resolved by
 * `extension/scripts/platform.ts`, or $BEIFAHRER_E2E_CHROMIUM. Playwright itself is NOT a
 * dependency of this repository; the browsers in its cache were put there by something else, and
 * this script drives one over the DevTools protocol exactly as `tests/e2e/` does.
 *
 * It needs no display and must NOT be wrapped in `scripts/headless-run`: headless Chromium opens
 * no window. The native window capture does need it, and tools/desktop-shots.sh does it there.
 *
 * Ports: the file server binds port 0 and DevTools binds port 0, so a run can never collide with
 * the person's sessions (47813–47822), the e2e (47900+) or the dev browser (47830–47839).
 *
 * Portability note: the neutral frame becomes a candidate for `@gjsify/site` the day a SECOND app
 * wants one. Until then it stays here — `@gjsify/site` consumes images, it does not author them.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumBinary } from '../extension/scripts/platform.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** One entry per picture: the template, the file it writes, and what it must not be missing. */
const PICTURES = {
  frame: { template: 'tools/compose/frame.html', out: 'frame-light.png', needs: [] },
  hero: {
    template: 'tools/compose/hero.html',
    out: 'hero-light.png',
    needs: ['docs/images/options-light.png', 'docs/images/desktop-light.png'],
  },
};

/** The canvas, and the scale that turns it into the store's 2560 × 1600. */
const CANVAS = { width: 1280, height: 800, scale: 2 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function usage() {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(
    header
      .slice(header.indexOf('/**'), header.indexOf(' */') + 3)
      .replace(/^\/\*\*\n?|^ \* ?| \*\/$/gm, '')
      .trim(),
  );
}

/**
 * The repository, served read-only over loopback.
 *
 * A `file:` URL would be simpler and is not usable: the templates `fetch` their strings, and a
 * file: document cannot fetch. Serving the repository root also means every path in a template is
 * the repository path (`/docs/images/options-light.png`), so what the picture contains is readable
 * from the markup without resolving anything.
 */
function serveRepo() {
  const server = createServer((req, res) => {
    // Resolve inside the repository or refuse: a `..` in a request must not reach the disk above it.
    const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT + '/') || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/**
 * A DevTools connection, with `send` returning the answer to its own id.
 *
 * A failed command REJECTS, and a socket that closes rejects everything still waiting on it.
 * Without that, a command that failed came back as a reply with no `result`, and the first thing
 * to touch it blamed itself — a screenshot that the browser had refused surfaced as a TypeError
 * about `undefined`, two frames away from the protocol error that caused it.
 */
function rpc(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const pending = new Map();
  const settle = (fn) => {
    for (const [, p] of pending) fn(p);
    pending.clear();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.fail(new Error(`${p.method}: ${m.error.message ?? JSON.stringify(m.error)}`));
    else p.ok(m);
  };
  ws.onclose = () => settle((p) => p.fail(new Error(`${p.method}: the browser closed the connection`)));
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const id = ++n;
      pending.set(id, { ok, fail, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((ok, fail) => {
    ws.onopen = () => ok({ send, close: () => ws.close() });
    ws.onerror = fail;
  });
}

/**
 * Headless Chromium on a throw-away profile, and the page target to drive.
 *
 * The flags after `--headless=new` are the reproducibility ones: a fixed sRGB profile and grayscale
 * antialiasing, so the same markup on another machine's colour setup still rasterises the same way,
 * and no scrollbar, which would otherwise appear in the capture the moment a template grew a pixel.
 */
async function startBrowser(origin) {
  const bin = chromiumBinary();
  if (!bin) throw new Error('no Chromium — set $BEIFAHRER_E2E_CHROMIUM (see extension/scripts/platform.ts)');
  const profile = mkdtempSync(join(tmpdir(), 'beifahrer-compose-'));
  const proc = spawn(
    bin,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      // The SCALE on the command line rather than over the protocol: a renderer that is told its
      // scale only after it exists has already rasterised something at scale 1, and whether that
      // raster got reused for the shot decided how heavy the text came out (see `capture`).
      `--force-device-scale-factor=${CANVAS.scale}`,
      `--window-size=${CANVAS.width},${CANVAS.height}`,
      // Glyphs the same weight every time: no hinting (a hinted outline snaps to the pixel grid,
      // and which grid depends on the scale the glyph was first cached at) and no tile reuse.
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
      '--disable-partial-raster',
      // Port 0: the browser writes the one it got to DevToolsActivePort, so no range is reserved.
      '--remote-debugging-port=0',
      // Nothing of this repository at startup: a template opened here would still be the live
      // document, `ready` and all, while the first capture is navigating — see `capture`.
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  }
  if (!port) throw new Error('Chromium never reported a DevTools port');
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(100);
    const list = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .catch(() => []);
    target = list.find((t) => t.type === 'page');
  }
  if (!target) throw new Error('Chromium opened no page target');
  const page = await rpc(target.webSocketDebuggerUrl);
  /*
   * The LAYOUT viewport, once, before anything of this repository is navigated to.
   *
   * `--window-size` does not survive as the viewport here — the window came up 1280 × 657 CSS —
   * and a capture is not a scroll: everything below the viewport's bottom edge is never rastered
   * and comes out as flat background. That cost the bottom 98 px of the page capture, which
   * published would have read as a screenshot of a page that stops in the middle of nothing.
   *
   * This changes the size only. The scale is already 2 from the command line, so no glyph is ever
   * rasterised at one scale and then again at another, which is the race `capture` describes.
   */
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: CANVAS.width,
    height: CANVAS.height,
    deviceScaleFactor: CANVAS.scale,
    mobile: false,
  });
  return { proc, profile, page };
}

/**
 * One picture: navigate, wait for the page to say it is ready, capture the canvas.
 *
 * The wait is on the page's own signal and NOT on a timer. tools/compose/chrome.js sets it after
 * every image has decoded and `document.fonts.ready` has resolved; a sleep in its place is a race
 * with both, and the run that lost the race would write different bytes from the one that won it.
 *
 * The canvas size and scale come from the command line (startBrowser) and are deliberately NOT set
 * here over `Emulation`: changing device metrics relayouts and re-rasterises the page, and doing
 * that after the ready signal races the screenshot against the new raster. That race was measured —
 * the same text came out with three different weights across six runs — so the renderer is born at
 * the size it is captured at, and `ready` then means ready at that size.
 *
 * The wait asks for the URL as well as the signal, because between `Page.navigate` returning and
 * the new document committing the OLD one is still live — and the previous picture left it with
 * `ready` set. Asking only for the signal captured that stale document now and then, which is the
 * second way these files came out with differing bytes.
 */
async function capture(page, url, file) {
  await page.send('Page.navigate', { url });
  const started = Date.now();
  for (;;) {
    // While the new document is committing there is briefly no context to evaluate in, and the
    // browser says so. That is this loop's normal middle, not a failure: ask again.
    const res = await page
      .send('Runtime.evaluate', {
        expression: `location.href === ${JSON.stringify(url)} && document.documentElement.dataset.ready === '1'`,
        returnByValue: true,
      })
      .catch(() => null);
    if (res?.result?.result?.value === true) break;
    if (Date.now() - started > 30_000) throw new Error(`${url} never became ready`);
    await sleep(100);
  }
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height, scale: 1 },
  });
  const png = Buffer.from(shot.result.data, 'base64');
  writeFileSync(file, png);
  return png;
}

/** Width and height out of the IHDR, so the size claim is read from the file, not from the request. */
function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage();
  const outFlag = args.indexOf('--out');
  const outDir = outFlag === -1 ? join(ROOT, 'docs/images') : resolve(args[outFlag + 1]);
  const which = args.find((a) => a in PICTURES) ?? 'all';
  const wanted = which === 'all' ? Object.keys(PICTURES) : [which];

  for (const name of wanted)
    for (const need of PICTURES[name].needs)
      if (!existsSync(join(ROOT, need)))
        throw new Error(`${name} needs ${need} — produce it first (see this file's header)`);

  mkdirSync(outDir, { recursive: true });
  const server = await serveRepo();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await startBrowser(origin);
  try {
    for (const name of wanted) {
      const { template, out } = PICTURES[name];
      const file = join(outDir, out);
      const png = await capture(browser.page, `${origin}/${template}`, file);
      const { width, height } = pngSize(png);
      if (width !== CANVAS.width * CANVAS.scale || height !== CANVAS.height * CANVAS.scale)
        throw new Error(
          `${out} is ${width}×${height}, not ${CANVAS.width * CANVAS.scale}×${CANVAS.height * CANVAS.scale}`,
        );
      console.log(`${out}  ${width}×${height}  sha256:${createHash('sha256').update(png).digest('hex')}`);
    }
  } finally {
    browser.page.close();
    server.close();
    // Wait for the browser to be GONE before the profile is, and not merely asked to go: it keeps
    // writing into that directory as it shuts down, and removing it underneath a still-flushing
    // process failed the run with ENOTEMPTY after both pictures had already been written correctly.
    browser.proc.kill('SIGTERM');
    await new Promise((done) => {
      if (browser.proc.exitCode !== null || browser.proc.signalCode !== null) return done();
      const hard = setTimeout(() => browser.proc.kill('SIGKILL'), 5_000);
      browser.proc.once('exit', () => {
        clearTimeout(hard);
        done();
      });
    });
    rmSync(browser.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

await main();
