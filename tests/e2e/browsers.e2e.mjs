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
/** The access build sets this origin to `none` explicitly: a block no temporary grant reaches. */
const BLOCKED = `http://[::1]:${FIXTURE_PORT}`;
const TOKEN = `e2e-${Math.random().toString(36).slice(2)}`;
/**
 * Every e2e bridge reports this desktop accent (BEIFAHRER_DESKTOP_ACCENT, test-only), so the run
 * does not depend on the machine's GNOME setting; ui-pages.mjs checks the pages painted it.
 */
const DESKTOP_ACCENT = 'green';
/** Set BEIFAHRER_E2E_LOGS=<dir> to keep the MCP server's stderr and the browser's output. */
const LOGS = process.env.BEIFAHRER_E2E_LOGS;
const logTo = (name) => (LOGS ? createWriteStream(join(LOGS, name)) : null);
/** Set BEIFAHRER_E2E_LANG=de to run Chromium in another UI language (for localized screenshots). */
const LANG = process.env.BEIFAHRER_E2E_LANG;

const FIXTURE = `<!doctype html><html><head><title>beifahrer fixture</title></head><body>
<h1>Ticket 3279</h1>
<p>Secret-ish body text for page_read.</p>
<label for="plain">Plain comment</label><textarea id="plain"></textarea>
<div id="editor" contenteditable="true" aria-label="Model editor"><p>old</p></div>
<div id="bare" contenteditable="true" aria-label="Bare editor"></div>
<button id="send">Send</button>
<button id="demo">Demo</button>
<p id="demo-output"></p>
<!-- Keys, dropdowns and checkboxes: the three shapes page_press / page_select / page_check act on.
     Each writes into the page's own state and says so in the text, so a check can tell "the call
     returned" from "the page changed" — the difference every other write here is measured by. -->
<label for="keyboard">Keyboard field</label><input id="keyboard" name="keyboard">
<label for="keys-log">Keys log</label><input id="keys-log" readonly>
<label for="country">Country</label>
<select id="country">
  <option value="">—</option>
  <option value="de">Germany</option>
  <option value="nl">Netherlands</option>
  <option value="se">Sweden</option>
</select>
<label for="terms"><input type="checkbox" id="terms"> Accept terms</label>
<label for="radio-a"><input type="radio" name="choice" id="radio-a" value="a"> Choice A</label>
<label for="radio-b"><input type="radio" name="choice" id="radio-b" value="b"> Choice B</label>
<div role="checkbox" tabindex="0" id="aria-box" aria-checked="false" aria-label="Aria switch">Aria switch</div>
<form id="keyform" action="/submitted"><label for="keyform-note">Key form note</label><input id="keyform-note"><button type="submit">Key form apply</button></form>
<p id="press-output"></p>
<a href="/sample" id="sample-link">sample link</a>
<p>clicks: <span id="clicks">0</span> · pastes: <span id="pastes">0</span> <span id="pasteinfo"></span></p>
<p>indicator:<span id="ind"></span>.</p>
<beifahrer-open-card>slotted text</beifahrer-open-card>
<beifahrer-closed-card></beifahrer-closed-card>
<!-- Issue #30: one frame on the page's own origin (127.0.0.1, like the page) and one on another
     (localhost — the same server, a different origin). The second is the negative case:
     contentDocument is null for it, so it must stay invisible and the walk must not even name it. -->
<iframe id="frame-inside" title="Editor frame" src="http://127.0.0.1:${FIXTURE_PORT}/frame-inside"></iframe>
<iframe id="frame-foreign" title="Foreign frame" src="http://localhost:${FIXTURE_PORT}/frame-foreign"></iframe>
<script>
  // Issue #4: a web-component-shaped page. The OPEN root is what the walk must enter — a labelled
  // button and a labelled field inside it, neither reachable from the light DOM, and a label whose
  // for= can only resolve inside the root. The CLOSED root is what it must not enter: the browser
  // keeps that promise, and beifahrer has to keep it too.
  // Every keydown, with the modifiers it carried, so a test can check that page_press reports the
  // key the caller NAMED rather than one the browser chose. Only keydown is recorded: keypress
  // carries the same key again, and a log that doubles every entry would make "one press" and
  // "two presses" look alike.
  const keys = [];
  const MODS = [['altKey', 'alt'], ['ctrlKey', 'ctrl'], ['metaKey', 'meta'], ['shiftKey', 'shift']];
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.getElementById('keyboard')) return;
    const mods = MODS.filter(([prop]) => e[prop]).map(([, name]) => name).join('+');
    keys.push((mods ? mods + '+' : '') + e.key);
    document.getElementById('keys-log').value = keys.join(' ');
  }, true);
  // The div-shaped checkbox: beifahrer has to CLICK it, because the page owns that state, and
  // setting aria-checked by hand would make it look ticked while this listener never ran.
  document.getElementById('aria-box').addEventListener('click', (e) => {
    const box = e.currentTarget;
    box.setAttribute('aria-checked', box.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
  document.getElementById('country').addEventListener('change', (e) => {
    document.getElementById('press-output').textContent = 'country:' + e.target.value;
  });
  document.getElementById('terms').addEventListener('change', (e) => {
    document.getElementById('press-output').textContent = 'terms:' + e.target.checked;
  });
  document.getElementById('keyform').addEventListener('submit', (e) => {
    e.preventDefault();
    document.getElementById('press-output').textContent = 'submitted:' + document.getElementById('keyform-note').value;
  });
  customElements.define('beifahrer-open-card', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<p>Text inside the open root.</p><slot></slot>' +
        '<label for="shadow-name">Shadow name</label><input id="shadow-name">' +
        '<button id="shadow-save">Shadow save</button>' +
        '<span id="shadow-clicks">shadow-clicks:0</span>';
      root.getElementById('shadow-save').addEventListener('click', () => {
        const count = root.getElementById('shadow-clicks');
        count.textContent = 'shadow-clicks:' + (Number(count.textContent.split(':')[1]) + 1);
      });
    }
  });
  customElements.define('beifahrer-closed-card', class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: 'closed' }).innerHTML =
        '<button>Secret in a closed root</button>' +
        '<label for="hidden-name">Hidden name</label><input id="hidden-name">';
    }
  });
</script>
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
  // ADR 0012: a button whose effect a page script records, for the script run. The text lands in
  // the DOM, so a script in the isolated world can read the result of a click it made.
  document.getElementById('demo').addEventListener('click', () => {
    document.getElementById('demo-output').textContent = 'demo ran';
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
        ...(LANG ? [`--lang=${LANG}`] : []),
        ...(LOGS ? ['--enable-logging=stderr', '--v=0'] : []),
        // Headless Chromium refuses a second start URL ("Multiple targets are not supported"),
        // so the forbidden-origin tab is opened over the DevTools endpoint once it is up.
        `--remote-debugging-port=${DEVTOOLS_PORT}`,
        url,
      ],
      {
        stdio: LOGS ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        // Chromium on Linux takes its UI language from LANGUAGE, not only from --lang.
        env: LANG ? { ...process.env, LANGUAGE: LANG } : process.env,
      },
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
      BEIFAHRER_DESKTOP_ACCENT: DESKTOP_ACCENT,
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
      {
        env: { ...process.env, BEIFAHRER_TOKEN_FILE: tokenFile, BEIFAHRER_DESKTOP_ACCENT: DESKTOP_ACCENT },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
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

/** A tool call that must NOT wait for the person: a prompt would hold it for two minutes. */
async function quickly(client, name, args, ms = 10_000) {
  return Promise.race([
    tool(client, name, args),
    sleep(ms).then(() => ({ error: true, text: `still waiting after ${ms} ms (a prompt?)` })),
  ]);
}

/**
 * ADR 0010, in the access build: "all sites" (read) is granted from the start, BLOCKED is set to
 * none, FORBIDDEN has no rule. The E2E hooks stand in for the popup's End and the prompt's
 * buttons; the browser's own permission prompt is granted up front (e2eHostOrigins).
 */
async function accessScenario(browser) {
  const name = `${browser} access`;
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-access-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const a = await startMcp(tokenFile, `${browser}-access-a.log`, { BEIFAHRER_SESSION_LABEL: 'e2e access A' });
  const proc = launch(browser, profile);
  const hook = (path) =>
    tool(a.client, 'tab_open', { url: `${ALLOWED}/__beifahrer_e2e/${path}`, active: false });
  try {
    await until(a.client, (s) => s.browsers?.length === 1, 60);

    const opened = await quickly(a.client, 'tab_open', { url: `${FORBIDDEN}/fixture`, active: false });
    const tabId = opened.error ? null : JSON.parse(opened.text).tab?.tabId;
    check(
      name,
      'all sites: a site with no rule opens without a prompt',
      tabId != null,
      opened.text.slice(0, 200),
    );
    // Firefox reports the new tab as a complete about:blank for a moment: read once it has landed.
    let read = { error: true, text: '' };
    for (let i = 0; i < 20; i++) {
      await tool(a.client, 'page_wait', { tabId, for: 'load' });
      read = await quickly(a.client, 'page_read', { tabId });
      if (!/non-web page/.test(read.text)) break;
      await sleep(500);
    }
    check(name, 'all sites: its page is readable', !read.error, read.text.slice(0, 200));
    const blocked = await quickly(a.client, 'tab_open', { url: `${BLOCKED}/fixture`, active: false });
    check(
      name,
      'an explicit none beats all sites, with no prompt',
      blocked.error && /blocked|not a web page/.test(blocked.text),
      blocked.text.slice(0, 200),
    );

    // The person ends it (popup's End): the same site now needs an answer.
    await hook('end-wide');
    await sleep(1000);
    const asked = tool(a.client, 'page_read', { tabId });
    await sleep(500);
    await hook('answer?scope=session');
    const afterSession = await asked;
    check(
      name,
      'after End, a prompt answered For this session lets the read through',
      !afterSession.error,
      afterSession.text.slice(0, 200),
    );
    const again = await quickly(a.client, 'page_read', { tabId });
    check(name, 'For this session: the next read needs no prompt', !again.error, again.text.slice(0, 200));

    // Another session: A's grant is not its grant. It is asked, and Deny is forbidden.
    const other = runTool(tokenFile, 'page_read', { tabId });
    await hook('answer?scope=deny');
    const denied = await other;
    check(
      name,
      "a session's grant does not reach another session, whose Deny is forbidden",
      denied.code !== 0 && /forbidden/.test(denied.out + denied.err),
      `${denied.code} ${(denied.out + denied.err).slice(0, 200)}`,
    );
  } finally {
    await a.client.close().catch(() => undefined);
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
/**
 * ADR 0012: the agent's own script, through the whole chain. The gate is the point of this run —
 * the script switch, the site level, the confirm window with the code in it, `world: "main"` —
 * plus what a test can actually prove about the script itself: it runs, it sees the DOM, the
 * extension's own APIs are not in its scope, and what comes back is bounded and flagged.
 *
 * Every allowed run needs its own hook tab (ADR 0012's e2e hooks): the person answers every run, and
 * a test that answered once and then carried on would prove nothing about the second one.
 */
/**
 * Issue #4: a page built from web components. The walk enters an OPEN shadow root — including the
 * name resolution, which decides whether an element is findable at all — and leaves a CLOSED one
 * alone, because the browser keeps that promise and so does beifahrer.
 */
/**
 * Issue #30: a frame on the page's own origin is followed, one on another origin is not. The
 * difference is the browser's, not ours — `contentDocument` is null for a cross-origin frame — and
 * the negative case matters as much as the positive one: a frame that is invisible in the walk must
 * be invisible in `read` too, or its text comes out the way a closed shadow root once did.
 */
async function frames(browser, client, allowed) {
  const inside = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    role: 'button',
    name: 'Frame done',
  });
  const hit = inside.error ? null : JSON.parse(inside.text);
  check(
    browser,
    'page_find reaches a button inside a same-origin frame',
    hit?.count === 1,
    inside.text.slice(0, 200),
  );
  check(
    browser,
    'and says which frame the ref belongs to',
    !!hit && /\[frame: [^\]]*\/frame-inside/.test(hit.matches[0].description),
    hit?.matches[0]?.description ?? inside.text.slice(0, 200),
  );

  const named = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    role: 'textbox',
    name: 'Frame note',
  });
  check(
    browser,
    'a label inside a frame names its field (ids resolve in the frame document)',
    !named.error && JSON.parse(named.text).count === 1,
    named.text.slice(0, 200),
  );

  const foreign = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    name: 'Foreign frame button',
  });
  check(
    browser,
    'a cross-origin frame stays invisible — no contentDocument, no gate to pass',
    !foreign.error && JSON.parse(foreign.text).count === 0,
    foreign.text.slice(0, 200),
  );

  const read = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 12_000 });
  check(
    browser,
    'page_read has the frame text, behind its own heading',
    !read.error &&
      /frame: [^\n]*\/frame-inside/.test(read.text) &&
      /Text inside the frame document\./.test(read.text),
    read.text.slice(0, 240),
  );
  check(
    browser,
    'and neither the heading nor the text of the cross-origin frame',
    !read.error && !/frame-foreign/.test(read.text) && !/Foreign frame button/.test(read.text),
    read.text.match(/frame: [^\n]*/)?.[0] ?? read.text.slice(0, 200),
  );

  const outline = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'page_outline gives each document its own section, headed by the frame URL',
    !outline.error &&
      /frame: [^\n]*\/frame-inside/.test(outline.text) &&
      outline.text.indexOf('Frame done') > outline.text.indexOf('frame-inside'),
    outline.text.slice(0, 240),
  );

  if (!hit) return;
  const ref = hit.matches[0].ref;
  const clicked = await tool(client, 'page_click', { tabId: allowed.tabId, ref });
  check(browser, 'a ref into a frame clicks there', !clicked.error, clicked.text.slice(0, 160));
  const after = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 12_000 });
  check(
    browser,
    "and the frame's own listener ran, which the page's text shows",
    !after.error && /frame-clicks:1/.test(after.text),
    after.text.match(/frame-clicks:\d/)?.[0] ?? after.text.slice(0, 200),
  );
}

/**
 * Keys, dropdowns, checkboxes: the three form shapes a person drives with a keyboard and an agent
 * could not reach at all.
 *
 * The check that matters throughout is the same one every other write in this file is measured by —
 * did the PAGE change, or did the call merely return? A key press is where that matters most,
 * because the events beifahrer sends are untrusted: a browser performs no default action for them,
 * so every effect below is one the page agent had to produce itself. The keys-log in the fixture
 * records what the page actually received, which is the only way to tell a real keypress from a
 * call that returned happily and changed nothing.
 */
async function keys(browser, client, allowed, ref) {
  const field = ref('Keyboard field');
  check(browser, 'the outline names the keyboard field', !!field, String(field));

  // One character: the events the page hears AND the character in the field. Both, because a page
  // that listens per keystroke and a field that shows a caret are the two halves of "typed".
  const one = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, key: 'a' });
  check(browser, 'page_press accepts a single character', !one.error, one.text.slice(0, 200));
  const afterOne = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'and the character lands in the field, not only in an event',
    /textbox "Keyboard field" = "a"/.test(afterOne.text),
    afterOne.text.match(/textbox "Keyboard field"[^\n]*/)?.[0] ?? afterOne.text.slice(0, 300),
  );
  check(
    browser,
    'and the page received the key it named, in its own keydown',
    /Keys log" = "a"/.test(afterOne.text),
    afterOne.text.match(/Keys log[^\n]*/)?.[0] ?? afterOne.text.slice(0, 200),
  );

  // Text: one key per character. A widget that filters as you type counts these, and a single
  // value-set would leave its counter at zero while looking perfectly right.
  const typed = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, text: 'bc' });
  check(browser, 'page_press types text', !typed.error, typed.text.slice(0, 200));
  const afterText = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'every character arrives as its own key, so a per-keystroke widget sees each',
    /Keys log" = "a b c"/.test(afterText.text),
    afterText.text.match(/Keys log[^\n]*/)?.[0] ?? afterText.text.slice(0, 300),
  );
  check(
    browser,
    'and they all end up in the field',
    /textbox "Keyboard field" = "abc"/.test(afterText.text),
    afterText.text.match(/textbox "Keyboard field"[^\n]*/)?.[0] ?? afterText.text.slice(0, 300),
  );

  // Modifiers: the page's own handler decides what Ctrl+ArrowDown means, and it can only do that
  // if the modifier flag on the event is the truth.
  const mod = await tool(client, 'page_press', {
    tabId: allowed.tabId,
    ref: field,
    key: 'Control+ArrowDown',
  });
  check(browser, 'page_press accepts modifiers', !mod.error, mod.text.slice(0, 200));
  const afterMod = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'and the modifier reaches the page with the key, on one event',
    /Keys log" = "[^"]*ctrl\+ArrowDown/.test(afterMod.text),
    afterMod.text.match(/Keys log[^\n]*/)?.[0] ?? afterMod.text.slice(0, 300),
  );

  // Backspace is the one editing key whose effect a person would immediately miss if it silently
  // did nothing — the field would look unchanged and the call would have returned.
  const back = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, key: 'Backspace' });
  check(browser, 'page_press accepts Backspace', !back.error, back.text.slice(0, 200));
  const afterBack = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'and Backspace deletes, which an untrusted key event does not do by itself',
    /textbox "Keyboard field" = "ab"/.test(afterBack.text),
    afterBack.text.match(/textbox "Keyboard field"[^\n]*/)?.[0] ?? afterBack.text.slice(0, 300),
  );

  // Tab moves the focus on, and says where it went: an agent that cannot see the focus cannot use
  // a tab strip at all, so the answer names the element that has it now.
  const tabbed = await tool(client, 'page_press', { tabId: allowed.tabId, key: 'Tab' });
  check(browser, 'page_press accepts Tab without a ref', !tabbed.error, tabbed.text.slice(0, 200));
  const afterTab = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'and Tab moved the focus on, which the outline marks where it is',
    /Keys log"[^\n]*\[focus\]/.test(afterTab.text),
    afterTab.text.match(/Keys log[^\n]*/)?.[0] ?? afterTab.text.slice(0, 300),
  );

  // Enter is the one key that can navigate. It has to submit the form the field is in, and a
  // browser will not do that for an untrusted event — so the answer is what the page did with it.
  const note = ref('Key form note');
  const entered = await tool(client, 'page_press', { tabId: allowed.tabId, ref: note, key: 'Enter' });
  check(browser, 'page_press accepts Enter', !entered.error, entered.text.slice(0, 200));
  const afterEnter = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'and Enter submits the form, which is the effect a person means by it',
    /submitted:/.test(afterEnter.text),
    afterEnter.text.match(/submitted:[^\n]*/)?.[0] ?? afterEnter.text.slice(0, 300),
  );

  // A key that belongs to the browser is refused BY NAME. Sending it and letting it go nowhere
  // would look like a page that ignored it, which sends the agent looking in the wrong place.
  const chrome = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, key: 'F12' });
  check(
    browser,
    "the browser's own keys are refused by name, not silently dropped",
    chrome.error && /belongs to the browser/.test(chrome.text),
    chrome.text.slice(0, 200),
  );

  // A modifier on its own presses nothing. Accepting it would answer "done" for a call that did
  // nothing at all, which is the one answer an agent cannot work around.
  const bareMod = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, key: 'Control' });
  check(
    browser,
    'a modifier on its own is refused: it presses nothing, and "done" would be a lie',
    bareMod.error && /modifier on its own/.test(bareMod.text),
    bareMod.text.slice(0, 200),
  );

  const both = await tool(client, 'page_press', { tabId: allowed.tabId, ref: field, key: 'a', text: 'b' });
  check(
    browser,
    'key and text together are refused rather than ordered by guesswork',
    both.error && /not both/.test(both.text),
    both.text.slice(0, 200),
  );

  const nonsense = await tool(client, 'page_press', {
    tabId: allowed.tabId,
    ref: field,
    key: 'ArrowLeftwards',
  });
  check(
    browser,
    'a name that is not a key is refused, and the refusal names it',
    nonsense.error && /ArrowLeftwards/.test(nonsense.text),
    nonsense.text.slice(0, 200),
  );

  // --- page_select ------------------------------------------------------------------------------
  const country = ref('Country');
  const chosen = await tool(client, 'page_select', { tabId: allowed.tabId, ref: country, values: ['de'] });
  check(
    browser,
    'page_select chooses by value and the page hears the change',
    !chosen.error && /country:de/.test(await outputOf(client, allowed)),
    chosen.text.slice(0, 200),
  );

  // The label, because an agent learns "Netherlands" from the outline and never sees `nl`.
  const byLabel = await tool(client, 'page_select', {
    tabId: allowed.tabId,
    ref: country,
    values: ['Netherlands'],
  });
  check(
    browser,
    'and by the label a person reads, which is what the outline shows',
    !byLabel.error && /country:nl/.test(await outputOf(client, allowed)),
    byLabel.text.slice(0, 200),
  );

  const missing = await tool(client, 'page_select', { tabId: allowed.tabId, ref: country, values: ['fr'] });
  check(
    browser,
    'a value that is not there is refused WITH the list, so the agent can choose again',
    missing.error && /Germany/.test(missing.text) && /Sweden/.test(missing.text),
    missing.text.slice(0, 240),
  );

  // A single select holds ONE value. Setting two leaves the DOM with the last one and would answer
  // "Germany, Sweden" — a list that is not what the page has, and exactly the kind of confident lie
  // an agent then builds its next step on.
  const two = await tool(client, 'page_select', {
    tabId: allowed.tabId,
    ref: country,
    values: ['Germany', 'Sweden'],
  });
  check(
    browser,
    'two values for a single select are refused, not silently reduced to the last one',
    two.error && /one/i.test(two.text),
    two.text.slice(0, 240),
  );

  // The empty option: a dropdown that starts at "—" is how a person says "none of these", and it is
  // reachable only by its empty value, which is a value like any other.
  const none = await tool(client, 'page_select', { tabId: allowed.tabId, ref: country, values: [''] });
  check(
    browser,
    "the dropdown's empty option is reachable, which is how a form is cleared",
    !none.error,
    none.text.slice(0, 200),
  );

  // --- page_check -------------------------------------------------------------------------------
  const terms = ref('Accept terms');
  const ticked = await tool(client, 'page_check', { tabId: allowed.tabId, ref: terms });
  check(
    browser,
    'page_check ticks a checkbox and the page hears it',
    !ticked.error && /terms:true/.test(await outputOf(client, allowed)),
    ticked.text.slice(0, 200),
  );
  const again = await tool(client, 'page_check', { tabId: allowed.tabId, ref: terms });
  check(
    browser,
    'setting it to the state it already has changes nothing and says so',
    !again.error && /changed":\s*false/.test(again.text),
    again.text.slice(0, 200),
  );
  const unticked = await tool(client, 'page_check', { tabId: allowed.tabId, ref: terms, checked: false });
  check(
    browser,
    'and unticking works too',
    !unticked.error && /terms:false/.test(await outputOf(client, allowed)),
    unticked.text.slice(0, 200),
  );

  // A radio is a group: checking B has to uncheck A, which only happens if the click is real.
  const b = ref('Choice B');
  const radio = await tool(client, 'page_check', { tabId: allowed.tabId, ref: b });
  const afterRadio = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'checking a radio unchecks the one before it, so the group really moved',
    !radio.error &&
      /radio "Choice A" \[ \]/.test(afterRadio.text) &&
      /radio "Choice B" \[x\]/.test(afterRadio.text),
    afterRadio.text.match(/radio "Choice[^\n]*/g)?.join(' | ') ?? radio.text.slice(0, 200),
  );
  check(
    browser,
    'and the radio call itself succeeded (its own answer, so a failure names itself)',
    !radio.error,
    radio.text.slice(0, 200),
  );

  // A widget built from divs: beifahrer must CLICK it and read the state back, because setting
  // aria-checked by hand would make it look ticked while the page's own state never moved.
  const aria = ref('Aria switch');
  const ariaOn = await tool(client, 'page_check', { tabId: allowed.tabId, ref: aria });
  const afterAria = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'a role=checkbox widget is clicked, and its aria-checked really changed',
    !ariaOn.error && /checkbox "Aria switch" \[x\]/.test(afterAria.text),
    afterAria.text.match(/Aria switch[^\n]*/)?.[0] ?? ariaOn.text.slice(0, 200),
  );
  const ariaBack = await tool(client, 'page_check', { tabId: allowed.tabId, ref: aria, checked: false });
  const afterAriaBack = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'and unticking it works, so that was a click and not a one-way flip',
    !ariaBack.error && /checkbox "Aria switch" \[ \]/.test(afterAriaBack.text),
    afterAriaBack.text.match(/Aria switch[^\n]*/)?.[0] ?? ariaBack.text.slice(0, 200),
  );
}

/** The page's own `#press-output`, read as the page wrote it. */
async function outputOf(client, allowed) {
  const read = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 12_000 });
  return read.text;
}

/** A ref for a link, read fresh from the outline — refs move with the page, so they are asked for. */
async function linkRef(client, allowed, name) {
  const outline = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  if (outline.error) return null;
  return new RegExp(`\\[(e\\d+)\\] link "${name}`).exec(outline.text)?.[1] ?? null;
}

/**
 * Navigation: moving the person's own tab.
 *
 * Two gates are tested here and they are not the same gate. A URL the agent supplies is checked
 * against the site it NAMES, exactly as `tab_open` is — that is the one that would let an agent
 * carry what it read away in a query string. Going back is checked against the tab as it is, and the
 * interesting case is the landing: the move has already happened, so the answer has to stop the
 * agent from reading what it landed on rather than pretend the move did not occur.
 */
async function navigation(browser, client, allowed, forbidden) {
  const start = await tool(client, 'page_read', { tabId: allowed.tabId });
  const startUrl = /fixture/.test(start.text) ? `${ALLOWED}/fixture` : null;
  check(browser, 'the tab starts on the fixture', startUrl !== null, start.text.slice(0, 200));

  // Stays on the fixture's own origin, so the destination IS allowed: the gate under test here is
  // the one about the TARGET, not the one about where the tab already is.
  const there = await tool(client, 'page_navigate', {
    tabId: allowed.tabId,
    url: `${ALLOWED}/elsewhere`,
  });
  check(
    browser,
    'page_navigate goes to a URL and reports where it landed',
    !there.error && /elsewhere/.test(there.text),
    there.text.slice(0, 240),
  );
  // The load is waited for, so the very next read sees the NEW page. Without that a page_read right
  // after a goto reads the document on its way out, and every navigation looks like it failed.
  const after = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'and the page is already loaded, so the next call reads the new page',
    !after.error && /Text that only this page has/.test(after.text) && !/Ticket 3279/.test(after.text),
    after.text.slice(0, 240),
  );

  // A LINK CLICK is what leaves a history entry that `back` can walk. `page_navigate` to a URL
  // replaces in this browser rather than pushing — measured: two navigations in a row and `back`
  // still said "Cannot find a next page in history" — so a test that navigates twice and expects
  // history would be testing the browser, not beifahrer.
  const there2 = await tool(client, 'page_navigate', { tabId: allowed.tabId, url: `${ALLOWED}/elsewhere` });
  check(browser, 'a second page, with a link back', !there2.error, there2.text.slice(0, 200));
  const homeLink = await linkRef(client, allowed, 'back to the fixture');
  const viaLink = homeLink
    ? await tool(client, 'page_click', { tabId: allowed.tabId, ref: homeLink })
    : { error: true, text: 'no link found' };
  // A click navigates without waiting, so the tab is mid-load here — which is also why an agent that
  // clicks a link has to wait afterwards, and why `page_wait` exists.
  await tool(client, 'page_wait', { tabId: allowed.tabId, for: 'load', timeoutMs: 10_000 });
  const afterLink = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'a link click moves the tab and leaves a history entry behind it',
    !viaLink.error && !afterLink.error && /Ticket 3279/.test(afterLink.text),
    afterLink.text.slice(0, 200),
  );

  // The invariant that holds on BOTH engines, because the engines differ here: Chromium's tabs,
  // opened over the DevTools endpoint, carry no session history at all and answer "no next page",
  // while Firefox's do. What beifahrer owes either way is that the ANSWER MATCHES THE BROWSER — it
  // moved and says moved, or it did not move and says so with the browser's own reason. Asserting
  // `moved: true` on Chromium would be asserting the browser's history, not this code.
  const before = await tool(client, 'page_read', { tabId: allowed.tabId });
  const back = await tool(client, 'page_navigate', { tabId: allowed.tabId, navigation: 'back' });
  const backMoved = /"moved":\s*true/.test(back.text);
  check(
    browser,
    `back: the answer matches the browser (${backMoved ? 'it moved' : 'no history to walk'})`,
    !back.error &&
      (backMoved || (/"reason":\s*"[^"]+"/.test(back.text) && /"moved":\s*false/.test(back.text))),
    back.text.slice(0, 240),
  );
  if (!backMoved) {
    const was = before.text.match(/"url":\s*"([^"]+)"/)?.[1] ?? 'x';
    check(
      browser,
      'and a back that did not move names the page the tab is STILL on, not another one',
      back.text.includes(`"url": "${was}"`),
      back.text.slice(0, 240),
    );
  }
  const afterBack = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'and the page the tab ended on is the one the next call reads',
    !afterBack.error && (backMoved ? /Second document/ : /Ticket 3279/).test(afterBack.text),
    afterBack.text.slice(0, 240),
  );

  const forwardAgain = await tool(client, 'page_navigate', { tabId: allowed.tabId, navigation: 'forward' });
  check(
    browser,
    'and a forward answers either way, never as a failure',
    !forwardAgain.error && /"moved":\s*(true|false)/.test(forwardAgain.text),
    forwardAgain.text.slice(0, 240),
  );

  const reload = await tool(client, 'page_navigate', { tabId: allowed.tabId, navigation: 'reload' });
  check(browser, 'and reloads', !reload.error, reload.text.slice(0, 240));

  // Back where we started, and by URL rather than by history: the checks that follow address the
  // fixture's elements by ref, and a test that leaves the tab somewhere else fails them all for a
  // reason that has nothing to do with what they check.
  const home = await tool(client, 'page_navigate', { tabId: allowed.tabId, url: `${ALLOWED}/fixture` });
  const home2 = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'and the tab is back on the fixture, which the checks after this one need',
    !home.error && /Ticket 3279/.test(home2.text),
    home.text.slice(0, 200) + ' | ' + home2.text.slice(0, 120),
  );

  // The gate that matters: a URL naming a site the person blocked.
  const blocked = await tool(client, 'page_navigate', { tabId: allowed.tabId, url: FORBIDDEN });
  check(
    browser,
    'a URL naming a site nobody allowed is forbidden — as tab_open is',
    blocked.error && blocked.text.startsWith('forbidden:'),
    blocked.text.slice(0, 240),
  );
  const stillThere = await tool(client, 'page_read', { tabId: allowed.tabId });
  check(
    browser,
    'and the tab did NOT move: the refusal came before the browser was told anything',
    !stillThere.error && /Ticket 3279/.test(stillThere.text),
    stillThere.text.slice(0, 240),
  );

  // Two destinations at once. Not a warning: guessing which of the two was meant is a guess about
  // where a person's tab goes, and the person answered for a different place than the one that opens.
  const both = await tool(client, 'page_navigate', {
    tabId: allowed.tabId,
    navigation: 'back',
    url: `${ALLOWED}/elsewhere`,
  });
  check(
    browser,
    'a url together with a history move is refused, not resolved by guesswork',
    both.error && /names no url/.test(both.text),
    both.text.slice(0, 240),
  );

  // A move that is not one of the four. The schema refuses it before it reaches the extension, and
  // that is the better place for it: an invented verb is not a thing to be told about politely.
  const nowhere = await tool(client, 'page_navigate', { tabId: allowed.tabId, navigation: 'backward' });
  check(
    browser,
    'a move that is not one of the four is refused, and nothing moves',
    nowhere.error,
    nowhere.text.slice(0, 240),
  );

  // A site the person never allowed, navigated to in a tab that is not the one being read.
  const onBlocked = await tool(client, 'page_navigate', {
    tabId: forbidden.tabId,
    url: `${ALLOWED}/elsewhere`,
  });
  check(
    browser,
    'moving a tab that is itself on a blocked site is refused before anything else',
    onBlocked.error && onBlocked.text.startsWith('forbidden:'),
    onBlocked.text.slice(0, 240),
  );

  // The honesty check, and the one this method could most easily get wrong: a move that did not
  // happen must not answer like one that did. A freshly opened tab has no history to go back to, and
  // "ok" there is how an agent ends up reading the page it believes it left.
  const fresh = await tool(client, 'tab_open', { url: `${ALLOWED}/elsewhere` });
  const freshTab = fresh.error ? null : JSON.parse(fresh.text).tab?.tabId;
  const nowhereToGo = freshTab
    ? await tool(client, 'page_navigate', { tabId: freshTab, navigation: 'back' })
    : { error: true, text: fresh.text };
  check(
    browser,
    'a tab with no history answers "did not move" rather than pretending it went back',
    !nowhereToGo.error && /"moved":\s*false/.test(nowhereToGo.text),
    nowhereToGo.text.slice(0, 240),
  );
  const stayedPut = freshTab
    ? await tool(client, 'page_read', { tabId: freshTab })
    : { error: true, text: fresh.text };
  check(
    browser,
    'and the page is still the one it was on, so the answer matches what the browser did',
    !stayedPut.error && /Second document/.test(stayedPut.text),
    stayedPut.text.slice(0, 240),
  );
}

async function shadowDom(browser, client, allowed) {
  const found = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    role: 'button',
    name: 'Shadow save',
  });
  const hit = found.error ? null : JSON.parse(found.text);
  check(
    browser,
    'page_find reaches a button inside an open shadow root, by role and name',
    hit?.count === 1 && /^e\d+$/.test(hit.matches[0].ref),
    found.text.slice(0, 200),
  );

  // The label resolves only where it is written: `label[for]` inside the root, never the document's.
  const named = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    role: 'textbox',
    name: 'Shadow name',
  });
  check(
    browser,
    'a label inside a shadow root names the field it labels',
    !named.error && JSON.parse(named.text).count === 1,
    named.text.slice(0, 200),
  );

  const closed = await tool(client, 'page_find', { tabId: allowed.tabId, name: 'Secret in a closed root' });
  check(
    browser,
    'a closed shadow root stays closed',
    !closed.error && JSON.parse(closed.text).count === 0,
    closed.text.slice(0, 200),
  );
  const hidden = await tool(client, 'page_find', {
    tabId: allowed.tabId,
    role: 'textbox',
    name: 'Hidden name',
  });
  check(
    browser,
    'and nothing inside it is findable by name either',
    !hidden.error && JSON.parse(hidden.text).count === 0,
    hidden.text.slice(0, 200),
  );

  const read = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 8_000 });
  check(
    browser,
    'page_read includes the text a person can see inside the open root',
    !read.error && /Text inside the open root\./.test(read.text),
    read.text.slice(0, 200),
  );
  check(
    browser,
    'and not the text in the closed one',
    !read.error && !/Secret in a closed root/.test(read.text),
    read.text.slice(0, 200),
  );
  check(
    browser,
    'slotted content is counted once, not twice',
    !read.error && read.text.split('slotted text').length === 2,
    `${read.text.split('slotted text').length - 1}x`,
  );

  const outline = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 200 });
  check(
    browser,
    'page_outline lists it, with a ref',
    !outline.error && /button "Shadow save"/.test(outline.text),
    outline.text.slice(0, 200),
  );

  if (!hit) return;
  const ref = hit.matches[0].ref;
  const clicked = await tool(client, 'page_click', { tabId: allowed.tabId, ref });
  check(
    browser,
    'a ref from inside a shadow root clicks that button',
    !clicked.error,
    clicked.text.slice(0, 160),
  );
  const after = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 8_000 });
  check(
    browser,
    "and the page's own listener inside the root ran",
    !after.error && after.text.includes('shadow-clicks:1'),
    after.text.match(/shadow-clicks:\d/)?.[0] ?? after.text.slice(0, 160),
  );
}

async function scripts(browser, client, allowed, forbidden) {
  // 0. The capability list is a contract, not a courtesy (issue #31). `browsers_list` has to tell an
  //    agent what this browser can serve BEFORE it calls anything: on a Manifest V3 build a content
  //    script may not compile a string, so `page.evaluate` must be absent from the list — with the
  //    reason, because "cannot" and "not allowed" are different problems.
  const listed = JSON.parse((await tool(client, 'browsers_list')).text).browsers[0];
  const canRunCode = browser !== 'chromium';
  check(
    browser,
    `browsers_list ${canRunCode ? 'carries' : 'omits'} page.evaluate`,
    canRunCode
      ? listed.capabilities.includes('page.evaluate')
      : !listed.capabilities.includes('page.evaluate'),
    `MV${listed.manifestVersion}: ${listed.capabilities.length} methods`,
  );
  if (!canRunCode) {
    check(
      browser,
      'and says why, in a sentence',
      typeof listed.unsupported?.['page.evaluate'] === 'string' &&
        /content security policy/.test(listed.unsupported['page.evaluate']),
      JSON.stringify(listed.unsupported ?? {}).slice(0, 200),
    );
    // The refusal comes from the capability list, before any page is opened and before any window.
    const walled = await quickly(client, 'page_evaluate', {
      tabId: allowed.tabId,
      script: 'return 1',
    });
    check(
      browser,
      'page_evaluate answers unsupported from the bridge gate, naming the browser',
      walled.error && /^unsupported:/.test(walled.text) && /cannot do page.evaluate/.test(walled.text),
      walled.text.slice(0, 240),
    );
    // Nothing below can happen here, and pretending otherwise would test a browser that does not
    // have the method: the gate that refuses is in the BRIDGE, ahead of every check in the
    // extension — ahead of the switch, the level and the window. That ordering is the point: an
    // agent is told the truest reason first ("this browser cannot"), not the next one in line.
    return;
  }

  // 1. Below the level: a site with no rule refuses a script, naming write.
  const onNothing = await quickly(client, 'page_evaluate', {
    tabId: forbidden.tabId,
    script: 'return document.title',
  });
  check(
    browser,
    'page_evaluate on a site below read is forbidden, naming the level it needs',
    onNothing.error && /forbidden/.test(onNothing.text) && /write/.test(onNothing.text),
    onNothing.text.slice(0, 200),
  );

  // 2. `world: "main"` is refused with the reason, not silently downgraded.
  const main = await quickly(client, 'page_evaluate', {
    tabId: allowed.tabId,
    script: 'return 1',
    world: 'main',
  });
  check(
    browser,
    'page_evaluate world=main answers unsupported with a reason',
    main.error && /^unsupported:/.test(main.text) && /content security policy/.test(main.text),
    main.text.slice(0, 200),
  );

  // 3. Bad input is refused before anything runs. A missing script is caught by the MCP schema
  //    first, so the empty one carries the check for the extension's own parser. An unknown key is
  //    refused TWICE over — the tool's strict schema names it here, the extension's parser names it
  //    again for a caller that is not this tool — so the check accepts either refusal and, above
  //    all, that it arrives at once: a timeout would mean the window had already opened.
  for (const [label, args, refused] of [
    ['an empty script', { tabId: allowed.tabId, script: '  ' }, /invalid/],
    ['a script too long to read', { tabId: allowed.tabId, script: 'a'.repeat(20_001) }, /invalid/],
    ['an unknown key', { tabId: allowed.tabId, script: 'return 1', eval: true }, /invalid|Unrecognized key/],
  ]) {
    const bad = await quickly(client, 'page_evaluate', args);
    check(
      browser,
      `page_evaluate refuses ${label}`,
      bad.error && refused.test(bad.text) && !/still waiting/.test(bad.text),
      bad.text.slice(0, 160),
    );
  }

  // 4. The confirm window is answered Deny → the script does not run. ONE call, and the hook tab
  //    answers whatever window is open; a second call here would open a second window and wait on
  //    it, which is a test that hangs rather than a test that proves anything.
  const pending = tool(client, 'page_evaluate', {
    tabId: allowed.tabId,
    script: 'return document.title',
  });
  await sleep(1_000);
  await tool(client, 'tab_open', {
    url: `${ALLOWED}/__beifahrer_e2e/confirm?answer=deny`,
    active: false,
  });
  const denied = await Promise.race([pending, sleep(15_000).then(() => null)]);
  check(
    browser,
    'a script the person denied answers "denied"',
    denied && denied.error && /^denied:/.test(denied.text ?? ''),
    denied ? String(denied.text).slice(0, 200) : 'still waiting after 15 s',
  );

  // 5. Every run after this one gets its own window, so each needs its own hook tab: the person
  //    answers every run, and a test that answered once and then assumed would test nothing.
  const allowScript = async (args, ms = 20_000) => {
    const call = tool(client, 'page_evaluate', args);
    await sleep(1_000);
    await tool(client, 'tab_open', {
      url: `${ALLOWED}/__beifahrer_e2e/confirm?answer=allow`,
      active: false,
    });
    return Promise.race([call, sleep(ms).then(() => null)]);
  };

  // 5. The same script, answered Allow. WHAT HAPPENS HERE IS A PLATFORM FACT, and the run measures
  //    it instead of assuming it (ADR 0012): a Manifest V3 content script shares the extension's
  //    content security policy, and that policy cannot name 'unsafe-eval'. A Manifest V3 browser
  //    never gets this far — check 0 caught it at the capability list — so only Firefox
  //    (Manifest V2, no content-script CSP) actually runs the code.
  const ran = await allowScript({
    tabId: allowed.tabId,
    script: `document.getElementById('demo').click();
      await new Promise((r) => setTimeout(r, 300));
      return {
        title: document.title,
        pageChanged: document.querySelector('#demo-output')?.textContent ?? null,
        extensionApis: [typeof chrome, typeof browser],
      };`,
  });
  if (!canRunCode) return;

  check(browser, 'a script the person allowed runs', ran && !ran.error, String(ran?.text).slice(0, 200));
  if (ran && !ran.error) {
    const out = JSON.parse(ran.text);
    check(browser, 'the script read the page title', out.value?.title === 'beifahrer fixture', ran.text);
    check(
      browser,
      "it clicked the page and the page's own listener ran",
      out.value?.pageChanged === 'demo ran',
      ran.text,
    );
    check(
      browser,
      "the extension APIs are not in the script's scope (ADR 0012)",
      Array.isArray(out.value?.extensionApis) && out.value.extensionApis.every((t) => t === 'undefined'),
      ran.text,
    );
    check(browser, 'the result says it is complete', out.truncated === false, ran.text);
    check(browser, 'the result names the world it ran in', out.world === 'isolated', ran.text);
  }

  if (!canRunCode) return;

  // 6. The API in scope: `beifahrer` carries the recipe's own verbs, so a script needs no DOM code.
  const viaApi = await allowScript({
    tabId: allowed.tabId,
    script: `const links = beifahrer.find({ role: 'link', name: 'sample' });
      const b = beifahrer.find({ role: 'button', name: 'Demo' })[0];
      beifahrer.click(b.ref);
      await beifahrer.sleep(300);
      return { links: links.map((l) => l.description), output: beifahrer.describe(b.ref), url: beifahrer.url };`,
  });
  check(
    browser,
    'a script can use the beifahrer API',
    !!viaApi && !viaApi.error,
    String(viaApi?.text).slice(0, 240),
  );
  if (viaApi && !viaApi.error) {
    const out = JSON.parse(viaApi.text);
    check(
      browser,
      'beifahrer.find returns refs and descriptions',
      Array.isArray(out.value?.links) && out.value.links.length > 0,
      viaApi.text.slice(0, 240),
    );
  }

  // 7. A thrown error comes back with its name, not as a hang.
  const threw = await allowScript({
    tabId: allowed.tabId,
    script: 'throw new TypeError("deliberate")',
  });
  check(
    browser,
    'a script that throws answers failed with the error name',
    !!threw && threw.error && /TypeError: deliberate/.test(threw.text),
    String(threw?.text).slice(0, 200),
  );

  // 8. A syntax error is the agent's own mistake, and is answered as invalid.
  const noCompile = await allowScript({
    tabId: allowed.tabId,
    script: 'this is not javascript',
  });
  check(
    browser,
    'a script that does not compile answers invalid',
    !!noCompile && noCompile.error && /invalid/.test(noCompile.text) && /compile/.test(noCompile.text),
    String(noCompile?.text).slice(0, 200),
  );

  // 9. What comes back is bounded, and says so — a result cannot fill the bridge.
  const huge = await allowScript({
    tabId: allowed.tabId,
    script: 'return { rows: Array.from({ length: 5000 }, (_, i) => ({ i, note: "x".repeat(200) })) }',
    maxChars: 2_000,
  });
  check(
    browser,
    'a huge result comes back truncated, not whole',
    !!huge && !huge.error,
    String(huge?.text).slice(0, 120),
  );
  if (huge && !huge.error) {
    const out = JSON.parse(huge.text);
    check(browser, 'the huge result is flagged truncated', out.truncated === true, huge.text.slice(0, 160));
    check(
      browser,
      'the huge result honours the cap',
      JSON.stringify(out.value).length <= 2_000,
      `${JSON.stringify(out.value).length} chars`,
    );
  }
}

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
    deniedFind.text.startsWith('forbidden:'),
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
    early.text.startsWith('timeout:'),
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
  const groupsSupported = !grouped.text.startsWith('unsupported:');
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
    defineDenied.error && defineDenied.text.startsWith('forbidden:'),
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
    ['page_navigate', { tabId: 1, url }],
    ['page_screenshot', { tabId: 1 }],
    ['page_fill', { tabId: 1, ref: 'e1', text: 'x' }],
    ['page_click', { tabId: 1, ref: 'e1' }],
    ['page_press', { tabId: 1, key: 'Enter' }],
    ['page_select', { tabId: 1, ref: 'e1', values: ['x'] }],
    ['page_check', { tabId: 1, ref: 'e1' }],
    ['page_find', { tabId: 1, role: 'button' }],
    ['page_wait', { tabId: 1, for: 'load' }],
    ['page_evaluate', { tabId: 1, script: 'return 1' }],
    ['page_download', { tabId: 1, url }],
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
    // `page.evaluate` on a Manifest V3 build never reaches the pause: the bridge's capability gate
    // is ahead of it, and "this browser cannot" is the truer answer for an agent than "paused"
    // (issue #31). Everything else must answer `paused` — that is the whole promise of ADR 0005.
    const wanted =
      name === 'page_evaluate' && browser === 'chromium'
        ? { error: true, text: /^unsupported:.*cannot do page.evaluate/ }
        : { error: true, text: /^paused:.*ask them to resume/ };
    if (!(r.error && wanted.text.test(r.text))) notPaused.push(`${name}: ${r.text}`);
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
        // ADR 0012: a script is refused like any other capability the person has not switched on —
        // before the per-site level, and naming the switch.
        ['page_evaluate', { tabId: allowed.tabId, script: 'return 1' }, 'Run scripts'],
      ]) {
        const r = await tool(client, name, args);
        // ADR 0012 + issue #31: a script is refused on a Manifest V3 build by the BRIDGE's capability
        // gate, which sits ahead of the switch in the extension. That is the better order to refuse
        // in — "this browser cannot" is truer than "the person has not switched it on", and it is
        // what an agent needs in order to stop retrying — so the test expects each, per engine.
        const asExpected =
          name === 'page_evaluate' && browser === 'chromium'
            ? r.error && /^unsupported:.*cannot do page.evaluate/.test(r.text)
            : r.error && new RegExp(`^feature_disabled:.*"${label}".*Ask them`).test(r.text);
        check(browser, `${name} is refused by default ("${label}")`, asExpected, r.text);
      }
      // The extension's own pages, once per browser: they do not depend on the build's switches.
      if (browser === 'chromium')
        await chromiumPages(check, DEVTOOLS_PORT, process.env.BEIFAHRER_E2E_SCREENSHOTS);
      else await firefoxPages(check, BIDI_PORT, process.env.BEIFAHRER_E2E_SCREENSHOTS);
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
      denied.error && denied.text.startsWith('forbidden:'),
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
      badRef.error && badRef.text.startsWith('not_found:'),
      badRef.text,
    );

    const openDenied = await tool(client, 'tab_open', { url: `${FORBIDDEN}/fixture?leak=1` });
    check(
      browser,
      'tab_open to a site nobody allowed is forbidden',
      openDenied.error && openDenied.text.startsWith('forbidden:'),
      openDenied.text,
    );

    const writeDenied = await tool(client, 'page_fill', { tabId: forbidden.tabId, ref: 'e1', text: 'x' });
    check(
      browser,
      'page_fill on a site nobody allowed is forbidden',
      writeDenied.error && writeDenied.text.startsWith('forbidden:'),
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

    await shadowDom(browser, client, allowed);
    await frames(browser, client, allowed);
    await keys(browser, client, allowed, ref);
    await navigation(browser, client, allowed, forbidden);
    await scripts(browser, client, allowed, forbidden);
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

const FRAME_FIXTURE = `<!doctype html><html><head><title>Frame document</title></head><body>
<h2>Editor frame</h2>
<p>Text inside the frame document.</p>
<label for="frame-note">Frame note</label><input id="frame-note">
<button id="frame-save">Frame save</button>
<button id="frame-done">Frame done</button>
<p id="frame-output">frame-clicks:0</p>
<script>
  let n = 0;
  document.getElementById('frame-done').addEventListener('click', () => {
    document.getElementById('frame-output').textContent = 'frame-clicks:' + ++n;
  });
</script>
</body></html>`;
const FOREIGN_FRAME_FIXTURE = `<!doctype html><html><head><title>Foreign frame</title></head><body>
<button>Foreign frame button</button>
</body></html>`;
// A page that is NOT the fixture, so a navigation can be told apart from "the page did not change
// yet" — the failure a page_read right after a goto produces when the load is not waited for.
const ELSEWHERE_FIXTURE = `<!doctype html><html><head><title>Elsewhere</title></head><body>
<h1>Second document</h1>
<p>Text that only this page has.</p>
<a href="/fixture" id="back-home">back to the fixture</a>
</body></html>`;
const page = (req) =>
  req.url?.startsWith('/elsewhere')
    ? ELSEWHERE_FIXTURE
    : req.url?.startsWith('/openproject')
      ? OP_FIXTURE
      : req.url?.startsWith('/frame-foreign')
        ? FOREIGN_FRAME_FIXTURE
        : req.url?.startsWith('/frame')
          ? FRAME_FIXTURE
          : FIXTURE;
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
  // The refusal checks below expect `forbidden` at once, not a prompt nobody answers (ADR 0010);
  // the access build switches asking back on.
  askOnDemand: false,
};

// Three builds: the person's switches can only be flipped in the browser's UI, which a headless
// test cannot click. `off` has the default features (tab management, sessions, screenshots off);
// `on` carries PR #8's stored `grants.manageTabs` (which must still switch tab management AND
// sessions on) plus screenshots; `paused` is stopped.
const BUILDS = {
  off: seed,
  on: {
    ...seed,
    grants: { manageTabs: true },
    // ADR 0012: the script switch is one of the far-reaching capabilities, so `on` turns it on
    // deliberately — the person would have to do exactly this in their own options page.
    features: { screenshot: true, script: true },
    confirmClose: false,
  },
  paused: { ...seed, paused: true },
  // ADR 0010: all sites (read) from the start, one site blocked, one reachable only by a grant.
  access: {
    ...seed,
    policy: { origins: { ...seed.policy.origins, [BLOCKED]: { level: 'none' } } },
    askOnDemand: true,
    e2eGrants: [{ scope: '*', level: 'read' }],
    e2eHostOrigins: [FORBIDDEN],
  },
};
for (const [gate, build] of Object.entries(BUILDS)) {
  buildExtension(build);
  for (const b of browsers) {
    if (gate === 'access') {
      console.log(`\n${b} (temporary access)`);
      try {
        await accessScenario(b);
      } catch (err) {
        check(b, 'access scenario ran', false, err.stack ?? String(err));
      }
      continue;
    }
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
