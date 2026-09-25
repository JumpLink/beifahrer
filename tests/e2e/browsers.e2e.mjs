#!/usr/bin/env node
/**
 * End-to-end, through the whole chain, in real browsers:
 *
 *   MCP client (this file) → `beifahrer mcp` on GJS → loopback bridge → extension → fixture page
 *
 * Usage:  node tests/e2e/browsers.e2e.mjs [chromium|firefox|all]
 *
 * Per browser, after the single-session runs, a multi-session run (ADR 0007): two MCP sessions, a
 * `beifahrer tool` and a faked older bridge connected to one headless browser at once, each on
 * its own port; one ending, and the person's per-session Disconnect.
 *
 * Ports: fixture 47901, DevTools 47903, bridges 47910–47919, all shifted by
 * $BEIFAHRER_E2E_PORT_BASE (default 47900) so two runs can share a machine. Never the person's
 * 47813–47822.
 *
 * Needs: the app bundle (`gjsify workspace beifahrer-cli build`), a Chromium that still loads
 * unpacked extensions (Chrome for Testing / Playwright's build — branded Chrome ≥ 137 does not)
 * via $BEIFAHRER_E2E_CHROMIUM or ~/.cache/ms-playwright, and Firefox via $BEIFAHRER_E2E_FIREFOX
 * or `firefox` on PATH. Both run headless with a throw-away profile — never the person's own.
 *
 * The fixture page lives on 127.0.0.1 and is allowed (write, no confirmation); the same page on
 * `localhost` is a DIFFERENT origin nobody allowed, which is what the negative cases use.
 */

import { spawn, execFileSync } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketServer } from 'ws';
import { chromiumPages, firefoxPages } from './ui-pages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Every port of a run is derived from this, so a parallel run can pick another base. */
const PORT_BASE = Number(process.env.BEIFAHRER_E2E_PORT_BASE) || 47900;
const FIXTURE_PORT = PORT_BASE + 1;
/** The range the e2e bridges bind and the test browsers probe: far from the person's 47813–47822. */
const RANGE = { base: PORT_BASE + 10, count: 10 };
const DEVTOOLS_PORT = PORT_BASE + 3;
/** Firefox's WebDriver BiDi, for the extension-page smoke (ui-pages.mjs). */
const BIDI_PORT = PORT_BASE + 4;
const ALLOWED = `http://127.0.0.1:${FIXTURE_PORT}`;
const FORBIDDEN = `http://localhost:${FIXTURE_PORT}`;
const TOKEN = `e2e-${Math.random().toString(36).slice(2)}`;
/** Set BEIFAHRER_E2E_LOGS=<dir> to keep the MCP server's stderr and the browser's output. */
const LOGS = process.env.BEIFAHRER_E2E_LOGS;
const logTo = (name) => (LOGS ? createWriteStream(join(LOGS, name)) : null);

const FIXTURE = `<!doctype html><html><head><title>beifahrer fixture</title></head><body>
<h1>Ticket 3279</h1>
<p>Secret-ish body text for page_read.</p>
<label for="plain">Plain comment</label><textarea id="plain"></textarea>
<div id="editor" contenteditable="true" aria-label="Model editor"><p>old</p></div>
<div id="bare" contenteditable="true" aria-label="Bare editor"></div>
<button id="send">Send</button>
<p>clicks: <span id="clicks">0</span> · pastes: <span id="pastes">0</span> <span id="pasteinfo"></span></p>
<p>indicator:<span id="ind"></span>.</p>
<script>
  let clicks = 0, pastes = 0;
  document.getElementById('send').addEventListener('click', () => { document.getElementById('clicks').textContent = ++clicks; });
  // A model-based editor in miniature: it takes the paste, parses the HTML itself, cancels the event.
  document.getElementById('editor').addEventListener('paste', (e) => {
    e.preventDefault();
    const cd = e.clipboardData;
    // What the page actually received — shown by page_read when the paste check fails.
    document.getElementById('pasteinfo').textContent = JSON.stringify({
      trusted: e.isTrusted, hasData: !!cd, types: cd ? [...cd.types] : null,
      html: cd ? cd.getData('text/html').length : -1, plain: cd ? cd.getData('text/plain').length : -1,
    });
    const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
    e.currentTarget.innerHTML = html;
    document.getElementById('pastes').textContent = ++pastes;
  });
  // What the PAGE can see of beifahrer's in-page pill: a host element that comes and goes. "+closed"
  // = it appeared and the page could not open its shadow root nor read any text; "-" = it left.
  new MutationObserver((records) => {
    const log = document.getElementById('ind');
    for (const r of records) {
      for (const n of r.addedNodes)
        if (n.localName === 'beifahrer-indicator')
          log.textContent += n.shadowRoot === null && n.textContent === '' ? ' +closed' : ' +OPEN';
      for (const n of r.removedNodes) if (n.localName === 'beifahrer-indicator') log.textContent += ' -';
    }
  }).observe(document.documentElement, { childList: true });
</script></body></html>`;

/**
 * A SYNTHETIC OpenProject-like page (no real OpenProject HTML — fixtures are synthetic): the two
 * metas the built-in recipes fingerprint, a comment box and a description that are buttons until
 * clicked and then turn into a contenteditable editor (with role=textbox, as CKEditor 5 does)
 * after a delay, and submit buttons that record what was posted. A csrf-token meta checks that
 * a meta fingerprint answers a count and never the content.
 */
const OP_FIXTURE = `<!doctype html><html><head><title>WP 42 fixture</title>
<meta name="app_base_path" content=""><meta name="app_title" content="WP 42">
<meta name="csrf-token" content="CSRF-MUST-NOT-LEAK">
</head><body>
<h1>Work package 42</h1>
<h2>Beschreibung</h2>
<div id="desc-box"><div id="desc" role="button" tabindex="0" aria-label="Beschreibung: Zum Bearbeiten klicken...">Alte Beschreibung</div></div>
<h2>Aktivität</h2>
<ul id="posted"></ul>
<p>posted: <span id="count">0</span> · saved: <span id="saved">0</span></p>
<div id="comment-box"></div>
<script>
  const EDITOR = (label) => '<div contenteditable="true" role="textbox" aria-label="' + label + '"><p><br></p></div>';
  function commentButton() {
    const box = document.getElementById('comment-box');
    box.innerHTML = '<button id="open">Kommentar…</button>';
    const open = box.querySelector('#open');
    open.setAttribute('aria-label', 'Einen Kommentar hinzufügen. @ tippen, um Personen zu benachrichtigen.');
    open.addEventListener('click', () => {
      box.innerHTML = '';
      // The editor mounts later, like CKEditor: a recipe must WAIT for it.
      setTimeout(() => {
        box.innerHTML = EDITOR('Editor-Bearbeitungsbereich: main') + '<button aria-label="Kommentar absenden">Senden</button>';
        box.querySelector('button').addEventListener('click', () => {
          const li = document.createElement('li');
          li.innerHTML = box.querySelector('[contenteditable]').innerHTML;
          document.getElementById('posted').append(li);
          document.getElementById('count').textContent = document.querySelectorAll('#posted li').length;
          commentButton();
        });
      }, 400);
    });
  }
  commentButton();
  document.getElementById('desc').addEventListener('click', () => {
    const box = document.getElementById('desc-box');
    const old = document.getElementById('desc').innerHTML;
    box.innerHTML = '';
    setTimeout(() => {
      box.innerHTML = EDITOR('Beschreibung') + '<button aria-label="Beschreibung: Speichern">✓</button>';
      box.querySelector('[contenteditable]').innerHTML = '<p>' + old + '</p>';
      box.querySelector('button').addEventListener('click', () => {
        const html = box.querySelector('[contenteditable]').innerHTML;
        box.innerHTML = '<div id="desc">' + html + '</div>';
        document.getElementById('saved').textContent = Number(document.getElementById('saved').textContent) + 1;
      });
    }, 300);
  });
</script></body></html>`;

/** A private recipe and a broken one, in a BEIFAHRER_RECIPES directory, like an operator's own. */
function writeRecipeDir(profile) {
  const dir = join(profile, 'recipes');
  mkdirSync(join(dir, 'e2e'), { recursive: true });
  writeFileSync(
    join(dir, 'e2e', 'read-ticket.json'),
    JSON.stringify({
      id: 'e2e/read-ticket',
      title: 'Read the ticket',
      description: 'Private recipe from BEIFAHRER_RECIPES',
      version: '1.0.0',
      match: { urls: ['http://127.0.0.1:*/fixture*'] },
      params: [],
      steps: [
        { id: 'heading', action: 'find', target: { role: 'heading', name: 'Ticket' } },
        { id: 'read', action: 'read', maxChars: 2000 },
      ],
    }),
  );
  writeFileSync(
    join(dir, 'e2e', 'evil.json'),
    JSON.stringify({
      id: 'e2e/evil',
      title: 'x',
      description: 'x',
      version: '1.0.0',
      match: { urls: ['*://*/*'] },
      steps: [{ id: 'x', action: 'evaluate', code: 'alert(1)' }],
    }),
  );
  return dir;
}

// ---------------------------------------------------------------------------------------------

const results = [];
function check(browser, name, ok, detail = '') {
  results.push({ browser, name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✖'} [${browser}] ${name}${ok ? '' : ` — ${detail}`}`);
}

function textOf(res) {
  return (res.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
}

async function tool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { error: res.isError === true, text: textOf(res), content: res.content };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.BEIFAHRER_E2E_CHROMIUM) return process.env.BEIFAHRER_E2E_CHROMIUM;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base)
    ? readdirSync(base)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const d of dirs.reverse()) {
    const bin = join(base, d, 'chrome-linux64', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return null;
}

function buildExtension(seed) {
  // The extension builds on GJS (scripts/build.ts); the seed makes it an E2E build in .output-e2e/.
  const env = { ...process.env, BEIFAHRER_E2E_SEED: JSON.stringify(seed) };
  execFileSync(join(ROOT, 'node_modules/.bin/gjsify'), ['run', 'build'], {
    cwd: join(ROOT, 'extension'),
    env,
    stdio: 'ignore',
  });
}

function launch(browser, profile) {
  const url = `${ALLOWED}/fixture`;
  if (browser === 'chromium') {
    const bin = findChromium();
    if (!bin) throw new Error('no Chromium that loads unpacked extensions — set BEIFAHRER_E2E_CHROMIUM');
    const ext = join(ROOT, 'extension/.output-e2e/chrome-mv3');
    return spawn(
      bin,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        `--load-extension=${ext}`,
        `--disable-extensions-except=${ext}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(LOGS ? ['--enable-logging=stderr', '--v=0'] : []),
        // Headless Chromium refuses a second start URL ("Multiple targets are not supported"),
        // so the forbidden-origin tab is opened over the DevTools endpoint once it is up.
        `--remote-debugging-port=${DEVTOOLS_PORT}`,
        url,
      ],
      { stdio: LOGS ? ['ignore', 'pipe', 'pipe'] : 'ignore' },
    );
  }
  const firefox = process.env.BEIFAHRER_E2E_FIREFOX ?? 'firefox';
  return spawn(
    join(ROOT, 'node_modules/.bin/web-ext'),
    [
      'run',
      '--source-dir',
      join(ROOT, 'extension/.output-e2e/firefox-mv2'),
      '--firefox',
      firefox,
      '--profile-create-if-missing',
      '--firefox-profile',
      profile,
      '--no-reload',
      '--no-input',
      '--arg=-headless',
      `--arg=--remote-debugging-port=${BIDI_PORT}`,
      '--arg=-remote-allow-system-access',
      '--start-url',
      url,
      '--start-url',
      `${FORBIDDEN}/fixture`,
    ],
    { stdio: LOGS ? ['ignore', 'pipe', 'pipe'] : 'ignore', detached: true },
  );
}

/** Start one `beifahrer mcp` over stdio, as an agent session would. */
async function startMcp(tokenFile, logName, env = {}) {
  const transport = new StdioClientTransport({
    command: join(ROOT, 'node_modules/.bin/gjsify'),
    args: [
      'run',
      join(ROOT, 'app/dist/beifahrer.gjs.mjs'),
      'mcp',
      '--port',
      String(RANGE.base),
      '--port-count',
      String(RANGE.count),
      '--allow-write',
    ],
    // Recipes from the test's own directory; XDG_CONFIG_HOME inside the throw-away profile so the
    // person's own ~/.config/beifahrer/recipes never takes part.
    env: {
      ...process.env,
      BEIFAHRER_TOKEN_FILE: tokenFile,
      XDG_CONFIG_HOME: join(dirname(tokenFile), 'config'),
      BEIFAHRER_RECIPES: writeRecipeDir(dirname(tokenFile)),
      ...env,
    },
    stderr: LOGS ? 'pipe' : 'ignore',
  });
  const client = new Client({ name: 'beifahrer-e2e', version: '0' });
  await client.connect(transport);
  const log = logTo(logName);
  if (log) transport.stderr?.pipe(log);
  return { client, transport };
}

async function browsersOf(client) {
  const r = await tool(client, 'browsers_list');
  return r.error ? { error: r.text } : JSON.parse(r.text);
}

/** Poll one session's browsers_list until `done(status)` or the deadline. */
async function until(client, done, seconds = 30) {
  let status = {};
  for (let i = 0; i < seconds * 2; i++) {
    status = await browsersOf(client);
    if (done(status)) break;
    await sleep(500);
  }
  return status;
}

const tabsOk = (r) => !r.error && JSON.parse(r.text).tabs.some((t) => t.url?.startsWith(ALLOWED));

/** `beifahrer tool <name>` as a separate process: binds its own port and waits for the browser. */
function runTool(tokenFile, name, args = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(
      join(ROOT, 'node_modules/.bin/gjsify'),
      [
        'run',
        join(ROOT, 'app/dist/beifahrer.gjs.mjs'),
        'tool',
        '--port',
        String(RANGE.base),
        '--port-count',
        String(RANGE.count),
        '--wait',
        '30',
        name,
        JSON.stringify(args),
      ],
      { env: { ...process.env, BEIFAHRER_TOKEN_FILE: tokenFile }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolveRun({ code, out, err }));
  });
}

/**
 * A bridge from before this design, faked in the test: it welcomes without a session and knows
 * only `tabs.list`. It stands for any session started from an older bundle. The point is that it
 * cannot hold back a newer session any more: nothing relays through it.
 */
function startOldBridge(port) {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  const state = { answered: null, server };
  server.on('connection', (ws) => {
    ws.once('message', (data) => {
      const hello = JSON.parse(String(data));
      if (hello.token !== TOKEN) return ws.close(4401, 'wrong token');
      ws.send(
        JSON.stringify({ type: 'welcome', protocol: 1, bridge: { version: '0.0.1' }, connectionId: 'old' }),
      );
      ws.on('message', (frame) => {
        const res = JSON.parse(String(frame));
        if (res.type === 'response' && res.id === 1) state.answered = res;
      });
      ws.send(JSON.stringify({ type: 'request', id: 1, method: 'tabs.list', params: {} }));
    });
  });
  return state;
}

/**
 * Several agent sessions, one browser (ADR 0007): two MCP sessions, a `beifahrer tool` and an
 * older bridge connected at once, each directly; one ending leaves the others; the person's
 * Disconnect holds until that session restarts.
 */
async function multiSession(browser) {
  const name = `${browser} sessions`;
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-multi-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  const sessions = [];
  const a = await startMcp(tokenFile, `${browser}-multi-a.log`, { BEIFAHRER_SESSION_LABEL: 'e2e session A' });
  sessions.push(a);
  const b = await startMcp(tokenFile, `${browser}-multi-b.log`);
  sessions.push(b);
  // The last port of the range, out of the way of the sessions that bind from the first one.
  const old = startOldBridge(RANGE.base + RANGE.count - 1);
  const proc = launch(browser, profile);
  try {
    const sa = await until(a.client, (s) => s.browsers?.length === 1, 60);
    const sb = await until(b.client, (s) => s.browsers?.length === 1);
    check(
      name,
      'two MCP sessions each have their own port and a direct connection',
      sa.browsers?.length === 1 && sb.browsers?.length === 1 && sa.port !== sb.port,
      `${JSON.stringify(sa).slice(0, 200)} | ${JSON.stringify(sb).slice(0, 200)}`,
    );
    check(
      name,
      'labels: BEIFAHRER_SESSION_LABEL, else MCP client name · directory',
      sa.session?.label === 'e2e session A' &&
        sb.session?.label === `beifahrer-e2e · ${basename(process.cwd())}`,
      `${sa.session?.label} | ${sb.session?.label}`,
    );

    // The third session: a `beifahrer tool` process, while both MCP sessions stay connected.
    const [viaTool, viaA, viaB] = await Promise.all([
      runTool(tokenFile, 'tabs_list'),
      tool(a.client, 'tabs_list'),
      tool(b.client, 'tabs_list'),
    ]);
    check(
      name,
      'beifahrer tool binds its own port and its tabs_list succeeds',
      viaTool.code === 0 && viaTool.out.includes(ALLOWED),
      `${viaTool.code}: ${viaTool.out.slice(0, 200)} ${viaTool.err.slice(-300)}`,
    );
    check(name, 'tabs_list succeeds in both MCP sessions at the same time', tabsOk(viaA) && tabsOk(viaB));

    for (let i = 0; i < 30 && !old.answered; i++) await sleep(500);
    check(
      name,
      'an older bridge (no session, tabs.list only) is served too',
      old.answered?.ok === true && Array.isArray(old.answered.result?.tabs),
      JSON.stringify(old.answered)?.slice(0, 200),
    );
    const tabs = JSON.parse(viaA.text).tabs;
    const allowed = tabs.find((t) => t.url?.startsWith(ALLOWED));
    const found = await tool(a.client, 'page_find', { tabId: allowed.tabId, role: 'button', name: 'send' });
    check(
      name,
      'meanwhile a newer session uses a method the older bridge does not know (page_find)',
      !found.error && JSON.parse(found.text).count >= 1,
      found.text.slice(0, 200),
    );

    // Session A ends: its MCP server exits with it. B is untouched.
    await a.client.close();
    sessions.splice(sessions.indexOf(a), 1);
    await sleep(1000);
    const afterA = await tool(b.client, 'tabs_list');
    check(name, 'one session ending leaves the others working', tabsOk(afterA), afterA.text.slice(0, 200));

    // The person disconnects B. A third MCP session opens the tab that stands in for the popup's
    // button (src/e2e-seed.ts), since a headless test cannot click the popup.
    const c = await startMcp(tokenFile, `${browser}-multi-c.log`, {
      BEIFAHRER_SESSION_LABEL: 'e2e session C',
    });
    sessions.push(c);
    await until(c.client, (s) => s.browsers?.length === 1);
    await tool(c.client, 'tab_open', {
      url: `${ALLOWED}/__beifahrer_e2e/disconnect?port=${sb.port}`,
      active: false,
    });
    const gone = await until(b.client, (s) => s.browsers?.length === 0, 15);
    check(name, 'Disconnect closes that session', gone.browsers?.length === 0, JSON.stringify(gone));
    await sleep(8000); // longer than a probe round
    const stillGone = await browsersOf(b.client);
    const refused = await tool(b.client, 'tabs_list');
    const cStill = await tool(c.client, 'tabs_list');
    check(
      name,
      'a disconnected session stays out (no reconnect), the others stay in',
      stillGone.browsers?.length === 0 && refused.error && tabsOk(cStill),
      `${JSON.stringify(stillGone)} | ${refused.text.slice(0, 120)}`,
    );

    // B restarts: a new bridge instance on the port it held is welcome again.
    await b.client.close();
    sessions.splice(sessions.indexOf(b), 1);
    await sleep(500);
    const d = await startMcp(tokenFile, `${browser}-multi-d.log`);
    sessions.push(d);
    const sd = await until(d.client, (s) => s.browsers?.length === 1);
    check(
      name,
      'a restarted session on the disconnected port is connected again',
      sd.browsers?.length === 1 && sd.port === sb.port,
      JSON.stringify(sd).slice(0, 200),
    );
  } finally {
    for (const s of sessions) await s.client.close().catch(() => undefined);
    old.server.close();
    try {
      process.kill(browser === 'firefox' ? -proc.pid : proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
  }
}

/** page_find, page_wait (issue #2) and recipes, against the synthetic OpenProject-like page. */
async function recipes(browser, client, allowed, forbidden) {
  const opened = await tool(client, 'tab_open', { url: `${ALLOWED}/openproject/wp/42`, active: false });
  check(browser, 'tab_open opens the OpenProject-like fixture', !opened.error, opened.text);
  if (opened.error) return;
  const op = JSON.parse(opened.text).tab.tabId;

  const loaded = await tool(client, 'page_wait', { tabId: op, for: 'load' });
  check(browser, 'page_wait for=load answers once the tab has loaded', !loaded.error, loaded.text);

  const found = await tool(client, 'page_find', { tabId: allowed.tabId, role: 'button', name: 'send' });
  const hit = found.error ? null : JSON.parse(found.text);
  check(
    browser,
    'page_find finds the button by role + name, with a ref',
    hit?.count === 1 && /^e\d+$/.test(hit.matches[0].ref) && hit.matches[0].description === 'button "Send"',
    found.text,
  );
  const clickByFind = await tool(client, 'page_click', {
    tabId: allowed.tabId,
    ref: hit?.matches[0]?.ref ?? 'e0',
  });
  check(browser, "page_find's ref works in page_click", !clickByFind.error, clickByFind.text);

  const csrf = await tool(client, 'page_find', { tabId: op, meta: { name: 'csrf-token' } });
  check(
    browser,
    'a meta check answers a count, never the content',
    !csrf.error && JSON.parse(csrf.text).count === 1 && !csrf.text.includes('CSRF-MUST-NOT-LEAK'),
    csrf.text,
  );

  const deniedFind = await tool(client, 'page_find', { tabId: forbidden.tabId, role: 'button' });
  check(
    browser,
    'page_find on a site nobody allowed is forbidden',
    /^forbidden:/.test(deniedFind.text),
    deniedFind.text,
  );

  const early = await tool(client, 'page_wait', {
    tabId: op,
    for: 'element',
    role: 'richtext',
    timeoutMs: 500,
  });
  check(
    browser,
    'page_wait gives up with timeout when nothing appears',
    /^timeout:/.test(early.text),
    early.text,
  );

  const list = await tool(client, 'recipes_list');
  const catalog = list.error ? { recipes: [], refused: [] } : JSON.parse(list.text);
  check(
    browser,
    'recipes_list: built-in + private recipes, the broken file refused',
    ['openproject/add-comment', 'openproject/edit-description', 'e2e/read-ticket'].every((id) =>
      catalog.recipes.some((r) => r.id === id),
    ) &&
      !catalog.recipes.some((r) => r.id === 'e2e/evil') &&
      catalog.refused.some((e) => e.source.endsWith('evil.json')),
    list.text.slice(0, 600),
  );

  const forOp = await tool(client, 'recipes_for_tab', { tabId: op });
  const forFixture = await tool(client, 'recipes_for_tab', { tabId: allowed.tabId });
  const ids = (r) =>
    r.error
      ? []
      : JSON.parse(r.text)
          .recipes.map((x) => x.id)
          .sort();
  check(
    browser,
    'recipes_for_tab matches OpenProject by fingerprint on any domain, and the private one by URL',
    JSON.stringify(ids(forOp)) ===
      JSON.stringify(['openproject/add-comment', 'openproject/edit-description']) &&
      JSON.stringify(ids(forFixture)) === JSON.stringify(['e2e/read-ticket']),
    `${forOp.text.slice(0, 300)} | ${forFixture.text.slice(0, 300)}`,
  );

  const privateRun = await tool(client, 'recipe_run', { tabId: allowed.tabId, id: 'e2e/read-ticket' });
  check(
    browser,
    'a private recipe runs (find + read)',
    !privateRun.error &&
      JSON.parse(privateRun.text).status === 'done' &&
      privateRun.text.includes('Secret-ish'),
    privateRun.text.slice(0, 400),
  );

  const wrongTab = await tool(client, 'recipe_run', {
    tabId: forbidden.tabId,
    id: 'openproject/add-comment',
    params: { text: 'x' },
  });
  check(
    browser,
    'recipe_run refuses a tab below read',
    wrongTab.error && wrongTab.text.includes('below level \\"read\\"'),
    wrongTab.text,
  );

  const draft = await tool(client, 'recipe_run', {
    tabId: op,
    id: 'openproject/add-comment',
    params: { text: '<p>Hallo <strong>Welt</strong></p>' },
  });
  const draftRun = draft.error ? {} : JSON.parse(draft.text);
  const afterDraft = await tool(client, 'page_read', { tabId: op });
  check(
    browser,
    'add-comment without an explicit request stops before submit: text in the editor, nothing posted',
    draftRun.status === 'stopped' &&
      draftRun.next === 'submit' &&
      afterDraft.text.includes('Hallo Welt') &&
      afterDraft.text.includes('posted: 0'),
    `${draft.text.slice(0, 600)} | ${afterDraft.text.slice(0, 400)}`,
  );

  const post = await tool(client, 'recipe_run', {
    tabId: op,
    id: 'openproject/add-comment',
    params: { text: '<p>Hallo <strong>Welt</strong></p>' },
    from: 'submit',
    explicitRequest: true,
  });
  const afterPost = await tool(client, 'page_read', { tabId: op });
  check(
    browser,
    'with explicitRequest the submit step posts the comment',
    !post.error && JSON.parse(post.text).status === 'done' && afterPost.text.includes('posted: 1'),
    `${post.text.slice(0, 400)} | ${afterPost.text.slice(0, 400)}`,
  );

  const desc = await tool(client, 'recipe_run', {
    tabId: op,
    id: 'openproject/edit-description',
    params: { text: '<p>Neue Beschreibung</p>' },
    explicitRequest: true,
  });
  const afterDesc = await tool(client, 'page_read', { tabId: op });
  check(
    browser,
    'edit-description replaces and saves the description',
    !desc.error &&
      JSON.parse(desc.text).status === 'done' &&
      afterDesc.text.includes('Neue Beschreibung') &&
      !afterDesc.text.includes('Alte Beschreibung') &&
      afterDesc.text.includes('saved: 1'),
    `${desc.text.slice(0, 500)} | ${afterDesc.text.slice(0, 400)}`,
  );

  const missing = await tool(client, 'recipe_run', { tabId: op, id: 'openproject/add-comment', params: {} });
  check(
    browser,
    'recipe_run refuses a missing required param',
    missing.error && /missing required param/.test(missing.text),
    missing.text,
  );

  await tool(client, 'tabs_close', { tabIds: [op] });
}

/** Order + pinned state of one window's tabs, as the agent sees them. */
async function windowLayout(client, windowId) {
  const { tabs } = JSON.parse((await tool(client, 'tabs_list')).text);
  return tabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.pinned ? '*' : ''}${t.url ? new URL(t.url).search || '/' : `host:${t.host}`}`);
}

/** Poll until a window shows `expected` (restored tabs appear and commit their URL one by one). */
async function waitForLayout(client, windowId, expected) {
  let layout = [];
  for (let i = 0; i < 40; i++) {
    layout = await windowLayout(client, windowId);
    if (JSON.stringify(layout) === JSON.stringify(expected)) break;
    await sleep(250);
  }
  return layout;
}

/**
 * Tab management, sessions and the recently-closed list. The gate is ON in this build; the
 * gate-off run checks the refusal separately.
 */
async function tabManagement(browser, client, forbidden) {
  const created = await tool(client, 'window_create', {
    tabs: ['a', 'b', 'c'].map((q) => ({ url: `${ALLOWED}/fixture?${q}` })),
  });
  check(browser, 'window_create opens a window with tabs', !created.error, created.text);
  if (created.error) return;
  const win = JSON.parse(created.text).windowId;

  // A tab on a site nobody allowed joins the window: sessions must carry it without showing it.
  const moved = await tool(client, 'tabs_move', { tabIds: [forbidden.tabId], windowId: win, index: -1 });
  check(browser, 'tabs_move moves a tab across windows', !moved.error, moved.text);
  await waitForLayout(client, win, ['?a', '?b', '?c', `host:localhost:${FIXTURE_PORT}`]);

  const idOf = async (search) => {
    const { tabs } = JSON.parse((await tool(client, 'tabs_list')).text);
    return tabs.find((t) => t.windowId === win && t.url && new URL(t.url).search === search)?.tabId;
  };
  const reorder = await tool(client, 'tabs_move', { tabIds: [await idOf('?c')], index: 0 });
  const pin = await tool(client, 'tabs_pin', { tabIds: [await idOf('?b')], pinned: true });
  const expected = ['*?b', '?c', '?a', `host:localhost:${FIXTURE_PORT}`];
  const layout = await waitForLayout(client, win, expected);
  check(
    browser,
    'tabs_move reorders and tabs_pin pins',
    !reorder.error && !pin.error && JSON.stringify(layout) === JSON.stringify(expected),
    `${reorder.text} | ${pin.text} | ${JSON.stringify(layout)}`,
  );

  // Tab groups, where the browser has them: c and a (adjacent, unpinned) into one named group.
  const grouped = await tool(client, 'tabs_group', {
    tabIds: [await idOf('?c'), await idOf('?a')],
    title: 'e2e',
    color: 'blue',
  });
  const groupsSupported = !/^unsupported:/.test(grouped.text);
  check(
    browser,
    `tabs_group ${groupsSupported ? 'groups tabs' : 'answers unsupported'}`,
    groupsSupported ? !grouped.error : grouped.error,
    grouped.text,
  );
  const sameGroup = async (windowId) => {
    const { tabs } = JSON.parse((await tool(client, 'tabs_list')).text);
    const inWin = tabs.filter((t) => t.windowId === windowId && t.url);
    const g = (q) => inWin.find((t) => new URL(t.url).search === q)?.groupId;
    return g('?c') !== undefined && g('?c') === g('?a') && g('?b') === undefined;
  };

  const saved = await tool(client, 'sessions_save', { name: 'e2e', windows: [win] });
  const savedTabs = saved.error ? [] : JSON.parse(saved.text).session.windows[0].tabs;
  check(
    browser,
    'sessions_save keeps 4 tabs, the unallowed one as host only',
    savedTabs.length === 4 &&
      savedTabs[3].url === undefined &&
      savedTabs[3].host === `localhost:${FIXTURE_PORT}`,
    saved.text,
  );
  const listed = await tool(client, 'sessions_list');
  check(
    browser,
    'sessions_list lists it',
    !listed.error && JSON.parse(listed.text).sessions.some((x) => x.name === 'e2e' && x.tabCount === 4),
    listed.text,
  );
  const defineDenied = await tool(client, 'sessions_define', {
    name: 'leak',
    windows: [{ tabs: [{ url: `${FORBIDDEN}/fixture?leak=1` }] }],
  });
  check(
    browser,
    'sessions_define with a site nobody allowed is forbidden',
    defineDenied.error && /^forbidden:/.test(defineDenied.text),
    defineDenied.text,
  );

  // The accident: the sorted window is closed.
  const closed = await tool(client, 'tabs_close', { windowId: win });
  check(browser, 'tabs_close closes the window', !closed.error, closed.text);
  await sleep(500);

  const restored = await tool(client, 'sessions_restore', { name: 'e2e' });
  const restoredWin = restored.error ? null : JSON.parse(restored.text).windowIds[0];
  const afterRestore = restoredWin ? await waitForLayout(client, restoredWin, expected) : [];
  check(
    browser,
    'sessions_restore brings back order and pinned state',
    JSON.stringify(afterRestore) === JSON.stringify(expected),
    `${restored.text} | ${JSON.stringify(afterRestore)}`,
  );

  if (groupsSupported && restoredWin)
    check(browser, 'sessions_restore regroups the tabs', await sameGroup(restoredWin));

  if (restoredWin) await tool(client, 'tabs_close', { windowId: restoredWin });
  await sleep(500);
  const recent = await tool(client, 'sessions_recently_closed');
  const entry = recent.error
    ? null
    : JSON.parse(recent.text).closed.find((c) => c.kind === 'window' && c.tabs.length === 4);
  check(browser, 'sessions_recently_closed lists the closed window', !!entry, recent.text);
  if (!entry) return;
  const back = await tool(client, 'sessions_restore_closed', { sessionId: entry.sessionId });
  const backWin = back.error ? null : JSON.parse(back.text).windowId;
  const afterBack = backWin ? await waitForLayout(client, backWin, expected) : [];
  check(
    browser,
    'sessions_restore_closed brings the window back as it was',
    JSON.stringify(afterBack) === JSON.stringify(expected),
    `${back.text} | ${JSON.stringify(afterBack)}`,
  );
}

/**
 * Built paused, as if the person had pressed Stop: EVERY tool answers `paused`, tabs_list too,
 * before any other check (the tab ids here do not even exist).
 */
async function pausedChecks(browser, client) {
  const url = `${ALLOWED}/fixture`;
  const calls = [
    ['tabs_list', {}],
    ['tab_active', {}],
    ['page_read', { tabId: 1 }],
    ['page_outline', { tabId: 1 }],
    ['page_screenshot', { tabId: 1 }],
    ['page_fill', { tabId: 1, ref: 'e1', text: 'x' }],
    ['page_click', { tabId: 1, ref: 'e1' }],
    ['page_find', { tabId: 1, role: 'button' }],
    ['page_wait', { tabId: 1, for: 'load' }],
    ['recipes_for_tab', { tabId: 1 }],
    ['recipe_run', { tabId: 1, id: 'openproject/add-comment', params: { text: 'x' } }],
    ['tab_open', { url }],
    ['tabs_move', { tabIds: [1], index: 0 }],
    ['tabs_pin', { tabIds: [1], pinned: true }],
    ['tabs_close', { tabIds: [1] }],
    ['tabs_group', { tabIds: [1] }],
    ['tabs_ungroup', { tabIds: [1] }],
    ['window_create', { tabs: [{ url }] }],
    ['sessions_save', { name: 'x' }],
    ['sessions_list', {}],
    ['sessions_restore', { name: 'x' }],
    ['sessions_delete', { name: 'x' }],
    ['sessions_define', { name: 'x', windows: [{ tabs: [{ url }] }] }],
    ['sessions_recently_closed', {}],
    ['sessions_restore_closed', { sessionId: 'x' }],
  ];
  const { tools } = await client.listTools();
  // browsers_list and recipes_list answer from the bridge; they never reach the browser.
  const browserTools = tools.map((t) => t.name).filter((n) => n !== 'browsers_list' && n !== 'recipes_list');
  check(
    browser,
    'the paused check covers every browser tool',
    browserTools.every((n) => calls.some(([c]) => c === n)),
    browserTools.filter((n) => !calls.some(([c]) => c === n)).join(', '),
  );
  const notPaused = [];
  for (const [name, args] of calls) {
    const r = await tool(client, name, args);
    if (!(r.error && /^paused:.*ask them to resume/.test(r.text))) notPaused.push(`${name}: ${r.text}`);
  }
  check(browser, `all ${calls.length} tools answer "paused"`, notPaused.length === 0, notPaused.join(' | '));
}

async function scenario(browser, gate) {
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  const { client } = await startMcp(tokenFile, `${browser}-mcp.log`);

  const proc = launch(browser, profile);
  if (browser === 'chromium') {
    for (let i = 0; i < 40; i++) {
      const ok = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/new?${FORBIDDEN}/fixture`, {
        method: 'PUT',
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) break;
      await sleep(250);
    }
  }
  const browserLog = logTo(`${browser}-browser.log`);
  if (browserLog) {
    proc.stdout?.pipe(browserLog);
    proc.stderr?.pipe(browserLog);
  }
  try {
    const { tools } = await client.listTools();
    check(
      browser,
      'MCP lists the write tools with --allow-write',
      tools.some((t) => t.name === 'page_fill'),
    );

    let connected = false;
    for (let i = 0; i < 60 && !connected; i++) {
      const r = await tool(client, 'browsers_list');
      connected = !r.error && JSON.parse(r.text).browsers.length > 0;
      if (!connected) await sleep(1000);
    }
    check(browser, 'extension connects and pairs', connected);
    if (!connected) return;
    if (gate === 'paused') return await pausedChecks(browser, client);
    const info = JSON.parse((await tool(client, 'browsers_list')).text).browsers[0];
    check(
      browser,
      `reports its engine (${info.label}, MV${info.manifestVersion})`,
      info.family === (browser === 'chromium' ? 'chromium' : 'firefox'),
    );

    // Give the two start pages a moment to finish loading.
    let tabs = [];
    for (let i = 0; i < 20; i++) {
      tabs = JSON.parse((await tool(client, 'tabs_list')).text).tabs;
      if (
        tabs.some((t) => t.url?.startsWith(ALLOWED)) &&
        tabs.some((t) => t.host === `localhost:${FIXTURE_PORT}`)
      )
        break;
      await sleep(500);
    }
    const allowed = tabs.find((t) => t.url?.startsWith(ALLOWED));
    const forbidden = tabs.find((t) => t.host === `localhost:${FIXTURE_PORT}`);

    if (gate === 'off') {
      // Built with the default feature switches: tab management, sessions and screenshots are off.
      // Every one of those tools is refused before the per-site level, naming the feature.
      for (const [name, args, label] of [
        ['tabs_pin', { tabIds: [allowed.tabId], pinned: true }, 'Manage tabs and windows'],
        ['tabs_move', { tabIds: [allowed.tabId], index: 0 }, 'Manage tabs and windows'],
        ['sessions_list', {}, 'Saved sessions'],
        ['sessions_save', { name: 'x' }, 'Saved sessions'],
        ['page_screenshot', { tabId: allowed.tabId }, 'Take screenshots'],
      ]) {
        const r = await tool(client, name, args);
        check(
          browser,
          `${name} is feature_disabled by default ("${label}")`,
          r.error && new RegExp(`^feature_disabled:.*"${label}".*Ask them`).test(r.text),
          r.text,
        );
      }
      // The extension's own pages, once per browser: they do not depend on the build's switches.
      if (browser === 'chromium')
        await chromiumPages(check, DEVTOOLS_PORT, process.env.BEIFAHRER_E2E_SCREENSHOTS);
      else await firefoxPages(check, BIDI_PORT);
      return;
    }
    check(
      browser,
      'tabs_list shows the allowed tab with url + title',
      allowed?.title === 'beifahrer fixture',
      JSON.stringify(tabs),
    );
    check(
      browser,
      'tabs_list shows the forbidden tab as host only (no url, no title)',
      forbidden && forbidden.url === undefined && forbidden.title === undefined && forbidden.level === 'none',
      JSON.stringify(forbidden),
    );

    const active = await tool(client, 'tab_active');
    check(browser, 'tab_active answers', !active.error, active.text);

    const read = await tool(client, 'page_read', { tabId: allowed.tabId });
    check(
      browser,
      'page_read returns the page text',
      read.text.includes('Secret-ish body text'),
      read.text.slice(0, 300),
    );

    // The in-page pill: shown while the agent reads, gone ~3 s after; the page sees an empty,
    // closed host element and nothing else. The first read's own "+" lands after its text was
    // taken, so the second read shows the first read's pill coming and going.
    await sleep(4000);
    const reread = await tool(client, 'page_read', { tabId: allowed.tabId });
    const pill = /indicator: ([^.]*)\./.exec(reread.text)?.[1] ?? '';
    check(
      browser,
      'the in-page pill appears during a read, closed to the page, and goes away after',
      pill.startsWith('+closed -') && !pill.includes('OPEN') && !reread.text.includes('beifahrer is reading'),
      reread.text.slice(0, 400),
    );

    const denied = await tool(client, 'page_read', { tabId: forbidden.tabId });
    check(
      browser,
      'page_read on a site nobody allowed is forbidden',
      denied.error && /^forbidden:/.test(denied.text),
      denied.text,
    );

    const outline = await tool(client, 'page_outline', { tabId: allowed.tabId });
    const ref = (label) => new RegExp(`\\[(e\\d+)\\] [a-z]+ "${label}`).exec(outline.text)?.[1];
    const plain = ref('Plain comment');
    const editor = ref('Model editor');
    const bare = ref('Bare editor');
    const send = ref('Send');
    check(
      browser,
      'page_outline gives refs for textarea, both editors and the button',
      !!(plain && editor && bare && send),
      outline.text,
    );
    check(browser, 'page_outline lists headings', outline.text.includes('h1 "Ticket 3279"'), outline.text);

    const fill1 = await tool(client, 'page_fill', {
      tabId: allowed.tabId,
      ref: plain,
      text: 'Kommentar vom Agenten',
    });
    check(
      browser,
      'page_fill sets a textarea',
      !fill1.error && fill1.text.includes('Kommentar vom Agenten'),
      fill1.text,
    );

    const fill2 = await tool(client, 'page_fill', {
      tabId: allowed.tabId,
      ref: editor,
      text: '<h2>Neu</h2><ul><li>eins</li></ul>',
      as: 'html',
    });
    const afterPaste = await tool(client, 'page_read', { tabId: allowed.tabId });
    // Chromium: through the editor's own paste handler (formatting survives in its model).
    // Firefox: an extension's synthetic paste carries no readable data by design, so the text
    // arrives via execCommand instead — the check is that it LANDED, and which path it took.
    const viaPaste = afterPaste.text.includes('pastes: 1');
    check(
      browser,
      `page_fill as=html lands in the editor (${viaPaste ? 'via its paste handler' : 'via execCommand'})`,
      !fill2.error && afterPaste.text.includes('eins') && (browser === 'firefox' || viaPaste),
      `${fill2.text} | ${afterPaste.text.slice(0, 400)}`,
    );

    const fill3 = await tool(client, 'page_fill', {
      tabId: allowed.tabId,
      ref: bare,
      text: 'plain rich text',
    });
    check(
      browser,
      'page_fill falls back to execCommand in a bare contenteditable',
      !fill3.error && fill3.text.includes('plain rich text'),
      fill3.text,
    );

    const click = await tool(client, 'page_click', { tabId: allowed.tabId, ref: send });
    const afterClick = await tool(client, 'page_read', { tabId: allowed.tabId });
    check(
      browser,
      'page_click clicks',
      !click.error && afterClick.text.includes('clicks: 1'),
      `${click.text} | ${afterClick.text.slice(0, 300)}`,
    );

    const badRef = await tool(client, 'page_click', { tabId: allowed.tabId, ref: 'e99999' });
    check(
      browser,
      'an unknown ref is not_found, not a crash',
      badRef.error && /^not_found:/.test(badRef.text),
      badRef.text,
    );

    const openDenied = await tool(client, 'tab_open', { url: `${FORBIDDEN}/fixture?leak=1` });
    check(
      browser,
      'tab_open to a site nobody allowed is forbidden',
      openDenied.error && /^forbidden:/.test(openDenied.text),
      openDenied.text,
    );

    const writeDenied = await tool(client, 'page_fill', { tabId: forbidden.tabId, ref: 'e1', text: 'x' });
    check(
      browser,
      'page_fill on a site nobody allowed is forbidden',
      writeDenied.error && /^forbidden:/.test(writeDenied.text),
      writeDenied.text,
    );

    const shot = await tool(client, 'page_screenshot', { tabId: allowed.tabId });
    const gotImage = shot.content?.some((c) => c.type === 'image');
    // Without the extra "all sites" grant the browser refuses — that refusal must be a clear
    // `forbidden`, not a hang. With it (not granted in this test), an image comes back.
    check(
      browser,
      `page_screenshot answers (${gotImage ? 'image' : shot.text.slice(0, 60)})`,
      gotImage || /^(forbidden|invalid):/.test(shot.text),
      shot.text,
    );

    await recipes(browser, client, allowed, forbidden);
    await tabManagement(browser, client, forbidden);
  } finally {
    await client.close().catch(() => undefined);
    try {
      process.kill(browser === 'firefox' ? -proc.pid : proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------

const which = process.argv[2] ?? 'all';
const browsers = which === 'all' ? ['chromium', 'firefox'] : [which];

const page = (req) => (req.url?.startsWith('/openproject') ? OP_FIXTURE : FIXTURE);
const fixture = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(req));
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, '127.0.0.1', r));
// `localhost` must reach the same server for the forbidden-origin cases.
const fixture6 = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(req));
});
await new Promise((r) => fixture6.listen(FIXTURE_PORT, '::1', r)).catch(() => undefined);

const seed = {
  token: TOKEN,
  port: RANGE.base,
  portCount: RANGE.count,
  policy: { origins: { [ALLOWED]: { level: 'write', confirmWrites: false } } },
};

// Three builds: the person's switches can only be flipped in the browser's UI, which a headless
// test cannot click. `off` has the default features (tab management, sessions, screenshots off);
// `on` carries PR #8's stored `grants.manageTabs` (which must still switch tab management AND
// sessions on) plus screenshots; `paused` is stopped.
const BUILDS = {
  off: seed,
  on: { ...seed, grants: { manageTabs: true }, features: { screenshot: true }, confirmClose: false },
  paused: { ...seed, paused: true },
};
for (const [gate, build] of Object.entries(BUILDS)) {
  buildExtension(build);
  for (const b of browsers) {
    const label = gate === 'paused' ? 'paused' : `features ${gate}`;
    console.log(`\n${b} (${label})`);
    try {
      await scenario(b, gate);
    } catch (err) {
      check(b, `scenario ran (${label})`, false, err.stack ?? String(err));
    }
    if (gate !== 'on') continue;
    console.log(`\n${b} (several agent sessions)`);
    try {
      await multiSession(b);
    } catch (err) {
      check(b, 'multi-session scenario ran', false, err.stack ?? String(err));
    }
  }
}

fixture.close();
fixture6.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
