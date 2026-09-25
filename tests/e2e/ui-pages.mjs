/**
 * The extension's own pages (popup, options, confirm), opened as the pages they are —
 * `chrome-extension://…` / `moz-extension://…` — in the browser the e2e already runs.
 *
 * What this proves: under the extension-page CSP (`script-src 'self'`, no eval) the shared `ui.js`
 * ran, `@gjsify/adwaita-web` defined its elements and injected its stylesheet, the elements
 * upgraded, and the static text was translated. A CSP block would leave every `adw-*` tag an
 * undefined, unstyled element with the page otherwise intact, which nothing else in the e2e sees.
 *
 * Neither browser lets a remote client simply navigate a tab to an extension page, so each opens
 * them from where the browser allows it: Chromium from the extension's own service worker
 * (`tabs.create`, over the DevTools endpoint), Firefox from the browser window over WebDriver
 * BiDi (chrome scope, `-remote-allow-system-access`). The tabs open in the background, so the
 * popup describes the fixture tab that stays active.
 *
 * BEIFAHRER_E2E_SCREENSHOTS=<dir> also writes Chromium screenshots of each page, light and dark,
 * and Firefox screenshots of each page at a wide and a narrow width (`<page>-firefox-<width>.png`),
 * which is where a layout that only Firefox gets wrong shows.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADW_ACCENT_BG_COLORS } from '@gjsify/adwaita-core';

const PAGES = ['popup', 'options', 'confirm'];
const WIDTH = { popup: 360, options: 800, confirm: 520 };
/** The confirm window opens on the request an E2E build holds for it (e2e-seed.ts). */
const HASH = { confirm: '#e2e-preview' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What BEIFAHRER_DESKTOP_ACCENT=green (browsers.e2e.mjs) must paint, from adwaita-core's palette. */
const ACCENT_BG = ADW_ACCENT_BG_COLORS.green;

/** Evaluated in each page: what "the Adwaita UI came up" means. */
const PROBE = `JSON.stringify({
  defined: ['adw-switch-row', 'adw-preferences-group', 'gtk-button'].every((t) => !!customElements.get(t)),
  styled: !!document.getElementById('adwaita-web-style'),
  upgraded: !!document.querySelector('adw-switch-row .adw-row-text, adw-action-row .adw-action-row-text, adw-status-page:not([hidden]) *'),
  translated: !document.querySelector('[data-i18n]') || [...document.querySelectorAll('[data-i18n]')].every((e) => e.textContent.trim() !== ''),
  lang: document.documentElement.lang,
  accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-bg-color').trim(),
  // The copy's house style, as the person sees it (scripts/locales.ts checks the catalogue).
  copy: !/[\u2013\u2014!\u201C\u201D\u201E]/.test(document.body.innerText),
  words: document.body.innerText.split(/\s+/).filter(Boolean).length,
})`;

function rpc(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) events.push(m);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++n;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, events, close: () => ws.close() });
    ws.onerror = reject;
  });
}

function judge(check, browser, page, raw) {
  let r = {};
  try {
    r = JSON.parse(raw);
  } catch {
    /* reported below */
  }
  check(
    browser,
    `${page}.html: Adwaita elements defined, styled and upgraded under the extension CSP`,
    r.defined && r.styled && r.upgraded,
    raw,
  );
  check(browser, `${page}.html: static text translated`, r.translated && !!r.lang, raw);
  check(browser, `${page}.html: follows the desktop accent the bridge reported`, r.accent === ACCENT_BG, raw);
  check(
    browser,
    `${page}.html: no dash, "!" or curly quote in the visible text (${r.words} words)`,
    r.copy,
    raw,
  );
}

/** Chromium: over the DevTools endpoint the e2e already opened. */
export async function chromiumPages(check, devtoolsPort, shotsDir) {
  const list = () => fetch(`http://127.0.0.1:${devtoolsPort}/json/list`).then((r) => r.json());
  // The beifahrer worker is the one whose manifest has a default_locale; component extensions
  // (Chromium ships a few, some with a `background.js` too) have none.
  let worker = null;
  for (const t of (await list()).filter((x) => x.type === 'service_worker')) {
    const c = await rpc(t.webSocketDebuggerUrl);
    const res = await c.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest().default_locale ?? null',
      returnByValue: true,
    });
    if (res.result?.result?.value === 'en') worker = { target: t, c };
    else c.close();
  }
  check('chromium', 'ui: the extension service worker is reachable', worker !== null);
  if (!worker) return;
  // Not `new URL(…).origin`: for a non-special scheme like chrome-extension: that is "null".
  const base = /^chrome-extension:\/\/[a-p]{32}/.exec(worker.target.url)?.[0];
  for (const page of PAGES) {
    const url = `${base}/${page}.html${HASH[page] ?? ''}`;
    const opened = await worker.c.send('Runtime.evaluate', {
      expression: `chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(() => 'ok')`,
      awaitPromise: true,
      returnByValue: true,
    });
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      target = (await list()).find((t) => t.type === 'page' && t.url === url);
    }
    if (!target) {
      check('chromium', `${page}.html opens`, false, JSON.stringify(opened.result).slice(0, 300));
      continue;
    }
    const c = await rpc(target.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH[page],
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Reload with the listeners on, so a CSP report or an exception during load is seen.
    await c.send('Page.reload');
    await sleep(1500);
    const probe = await c.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    judge(check, 'chromium', page, probe.result?.result?.value ?? JSON.stringify(probe));
    const problems = c.events
      .filter(
        (e) =>
          e.method === 'Runtime.exceptionThrown' ||
          (e.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(e.params.entry.text)),
      )
      .map((e) => JSON.stringify(e.params).slice(0, 200));
    check(
      'chromium',
      `${page}.html: no exception or CSP report while loading`,
      problems.length === 0,
      problems.join(' | '),
    );
    if (shotsDir) await screenshots(c, page, shotsDir);
    c.close();
    await worker.c.send('Runtime.evaluate', {
      expression: `chrome.tabs.query({ url: ${JSON.stringify(`${base}/${page}.html*`)} }).then((t) => chrome.tabs.remove(t.map((x) => x.id)))`,
      awaitPromise: true,
    });
  }
  worker.c.close();
}

async function screenshots(c, page, dir) {
  for (const scheme of ['light', 'dark']) {
    await c.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    await sleep(300);
    const height = (
      await c.send('Runtime.evaluate', {
        returnByValue: true,
        expression:
          "Math.ceil(Math.max(...[...document.querySelectorAll('main, adw-status-page:not([hidden])')].map((e) => e.getBoundingClientRect().bottom)))",
      })
    ).result.result.value;
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH[page],
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);
    const shot = await c.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: WIDTH[page], height, scale: 1 },
    });
    writeFileSync(join(dir, `${page}-${scheme}.png`), Buffer.from(shot.result.data, 'base64'));
  }
}

const FIREFOX_WIDTHS = { popup: [360], options: [1280, 480], confirm: [520] };

/**
 * BiDi's captureScreenshot refuses an extension page ("browsing contexts in privileged scope"), so
 * the browser window draws the tab itself: select it, size the window, `drawSnapshot` of the
 * page's window global, PNG through a canvas.
 */
async function firefoxShots(evalIn, win, url, page, dir) {
  for (const width of FIREFOX_WIDTHS[page]) {
    const data = await evalIn(
      win,
      `(async () => {
        const tab = gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec === ${JSON.stringify(url)});
        if (!tab) return 'no tab';
        gBrowser.selectedTab = tab;
        window.resizeTo(${width}, 900);
        await new Promise((r) => setTimeout(r, 600));
        const bmp = await tab.linkedBrowser.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
        const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        return canvas.toDataURL('image/png');
      })()`,
    );
    if (typeof data === 'string' && data.startsWith('data:image/png;base64,'))
      writeFileSync(
        join(dir, `${page}-firefox-${width}.png`),
        Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'),
      );
    else console.error(`firefox screenshot of ${page} at ${width}px failed: ${String(data).slice(0, 300)}`);
  }
}

/** Firefox: over WebDriver BiDi on `bidiPort` (launch passes --remote-debugging-port). */
export async function firefoxPages(check, bidiPort, shotsDir) {
  let c = null;
  for (let i = 0; i < 40 && !c; i++) {
    c = await rpc(`ws://127.0.0.1:${bidiPort}/session`).catch(() => null);
    if (!c) await sleep(500);
  }
  check('firefox', 'ui: WebDriver BiDi is reachable', c !== null);
  if (!c) return;
  try {
    await c.send('session.new', { capabilities: {} });
    const chromeTree = await c.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    const win = chromeTree.result?.contexts?.[0]?.context;
    const evalIn = async (context, expression) =>
      (await c.send('script.evaluate', { target: { context }, expression, awaitPromise: true })).result
        ?.result?.value;
    const host = await evalIn(
      win,
      "WebExtensionPolicy.getByID('beifahrer@jumplink.eu')?.mozExtensionHostname ?? ''",
    );
    check('firefox', 'ui: the extension is installed', !!host, String(host));
    if (!host) return;
    for (const page of PAGES) {
      const url = `moz-extension://${host}/${page}.html${HASH[page] ?? ''}`;
      // A background tab, opened by the browser itself: the same principal a click would use.
      await evalIn(
        win,
        `gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), inBackground: true }) && 1`,
      );
      let context;
      for (let i = 0; i < 40 && !context; i++) {
        await sleep(250);
        const tree = await c.send('browsingContext.getTree', {});
        context = tree.result?.contexts?.find((x) => x.url === url)?.context;
      }
      if (!context) {
        check('firefox', `${page}.html opens`, false);
        continue;
      }
      await sleep(1000);
      judge(check, 'firefox', page, String(await evalIn(context, PROBE)));
      if (shotsDir) await firefoxShots(evalIn, win, url, page, shotsDir);
      await c.send('browsingContext.close', { context });
    }
  } finally {
    await c.send('session.end').catch(() => undefined);
    c.close();
  }
}
