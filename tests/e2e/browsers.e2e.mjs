#!/usr/bin/env node
/**
 * End-to-end, through the whole chain, in real browsers:
 *
 *   MCP client (this file) → `beifahrer mcp` → loopback bridge → extension → fixture page
 *
 * The bridge runs on GJS by default (what Linux ships); $BEIFAHRER_E2E_BRIDGE=node starts it with
 * plain `node` instead, from the `--app node` bundle — the same sources, built for Node. Needs
 * that bundle (`gjsify workspace beifahrer-cli build:node`).
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
 * Needs: the app bundle for the chosen runtime (`gjsify workspace beifahrer-cli build`, or
 * `… build:node` under $BEIFAHRER_E2E_BRIDGE=node), a Chromium that still loads
 * unpacked extensions (Chrome for Testing / Playwright's build — branded Chrome ≥ 137 does not)
 * via $BEIFAHRER_E2E_CHROMIUM or Playwright's browser cache for this platform, and Firefox via
 * $BEIFAHRER_E2E_FIREFOX, the platform's own install, or `firefox` on PATH. Both paths are
 * resolved by extension/scripts/platform.ts. Both browsers run headless with a throw-away
 * profile — never the person's own.
 *
 * The fixture page lives on 127.0.0.1 and is allowed (write, no confirmation — except in the
 * `confirm` build, which leaves the confirmation on and answers the window as the person does); the
 * same page on `localhost` is a DIFFERENT origin nobody allowed, which is what the negative cases
 * use.
 */

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketServer } from 'ws';
// The file, not the package index: plain Node strips types but cannot run core's parameter
// properties, which the index would pull in. config-dir.ts has no imports of its own.
import { configDir } from '../../packages/local/src/config-dir.ts';
import { chromiumBinary, firefoxBinary, localBin } from '../../extension/scripts/platform.ts';
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

/**
 * Which runtime starts the bridge: `gjsify run` on GJS (the default, and what Linux ships) or
 * plain `node`. Set BEIFAHRER_E2E_BRIDGE=node to run the whole chain on a Node host.
 *
 * This is the driver, not the product: the app is built and started either way, and nothing in
 * `app/` reads the variable. What it measures is exactly one thing — whether the bridge needs
 * GJS — and the answer is a build question rather than a source one, which is why each runtime
 * gets its own bundle: gjsify routes GJS-only imports per `--app` while building, so the GJS bundle
 * keeps its `gi://Soup` (through @gjsify/ws) and a bare `node` refuses that scheme. `gjsify build
 * --app node` is the same sources with those imports resolved away.
 */
const BRIDGE_RUNTIME = (() => {
  const asked = process.env.BEIFAHRER_E2E_BRIDGE;
  if (asked === undefined || asked === 'gjs') return 'gjs';
  if (asked === 'node') return 'node';
  throw new Error(`BEIFAHRER_E2E_BRIDGE is "${asked}" — "gjs" (default) or "node"`);
})();
const BRIDGE_BUNDLE = join(ROOT, `app/dist/beifahrer.${BRIDGE_RUNTIME}.mjs`);

const FIXTURE = `<!doctype html><html><head><title>Beifahrer fixture</title></head><body>
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
<!-- Issue #35: what page_expect asserts on. Three shapes, and each one is a case the tool would get
     wrong on its own: a control ENABLED by something the page itself listens for, a control that
     HOLDS a value, and a spinner that comes back and goes away on its own — which is what makes
     "hidden" a condition to wait for rather than a lookup. Every change is the page's own doing, so
     a check can tell "the condition held" from "the call returned". -->
<label for="gate-note">Gate note</label><input id="gate-note" name="gate-note">
<button type="button" id="gate-save" disabled>Gate save</button>
<button type="button" id="spinner" style="display:none">Spinning</button>
<p id="gate-state">gate:disabled</p>
<p id="spin-state"></p>
<p id="gate-done"></p>
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
  // keeps that promise, and Beifahrer has to keep it too.
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
  // The div-shaped checkbox: Beifahrer has to CLICK it, because the page owns that state, and
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
  // Issue #35: the page decides when the gate opens and when the spinner goes — Beifahrer only
  // asserts. A script that flipped these itself would make every assertion pass while proving
  // nothing, so the transitions are the page's own listener and its own timer.
  document.getElementById('gate-note').addEventListener('input', (e) => {
    const save = document.getElementById('gate-save');
    save.disabled = e.target.value.trim() !== 'open';
    // The page's OWN report of that, so a test can measure the state somewhere other than in the
    // answer it is checking: an assertion that agreed with itself would prove nothing.
    document.getElementById('gate-state').textContent = save.disabled ? 'gate:disabled' : 'gate:enabled';
  });
  // Issue #35: the requests a network log is FOR. One GET with a token in its query (which must not
  // be reported) and one POST the server answers 500 to — "the button did nothing" in two rows.
  // The GET goes out on the FIRST click, not on load: a request made while the page loads races the
  // extension's watch, and Firefox lost that race (the row was simply not in the log). Only once, so
  // the "since" check after the second click can tell an old request from a new one.
  let pinged = false;
  document.getElementById('gate-save').addEventListener('click', () => {
    if (!pinged) {
      pinged = true;
      fetch('/api/ping?token=e2e-secret').catch(() => {});
    }
    fetch('/api/submit', { method: 'POST' }).catch(() => {});
    document.getElementById('gate-done').textContent = 'saved:' + document.getElementById('gate-note').value;
    // The spinner comes back and the PAGE takes it away again three seconds later, and the page says
    // which of the two it is in — so a test can tell "the assertion waited" from "the spinner was
    // already gone before the assertion started", which is what a click's own round trip decides.
    const spin = document.getElementById('spinner');
    const state = document.getElementById('spin-state');
    spin.style.display = '';
    state.textContent = 'spin:shown';
    setTimeout(() => {
      spin.style.display = 'none';
      state.textContent = 'spin:hidden';
    }, 3000);
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
  // What the PAGE can see of Beifahrer's in-page pill: a host element that comes and goes. "+closed"
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

function buildExtension(seed) {
  // The extension builds on GJS (scripts/build.ts); the seed makes it an E2E build in .output-e2e/.
  const env = { ...process.env, BEIFAHRER_E2E_SEED: JSON.stringify(seed) };
  const gjsify = localBin('gjsify', ROOT);
  execFileSync(gjsify.command, ['run', 'build'], {
    cwd: join(ROOT, 'extension'),
    env,
    stdio: 'ignore',
    shell: gjsify.shell,
  });
}

/**
 * Only the shapes a browser prints FOR a JavaScript error. A headless browser is otherwise full of
 * unrelated noise (GPU, sandbox, dbus, a refused favicon), and a check that counted those would
 * fail on the machine rather than on the code.
 */
const BROWSER_ERROR = /JavaScript error|ERROR:CONSOLE|Uncaught \(in promise\)|Uncaught \w*Error/;

/**
 * Stop a browser and everything it started.
 *
 * Firefox is spawned `detached`, so `-pid` is a POSIX process-GROUP id and one signal reaches the
 * whole group; Chromium is not detached, so only its own pid is signalled. That distinction is
 * POSIX semantics: a negative pid is not a process group on Windows, and there `taskkill /t` walks
 * the parent/child tree instead.
 *
 * Fail-safe by design: a browser that is already gone (the common case, `sleep` races and all) or
 * a `taskkill` that cannot start must not take the run with it — hence no `await`, no `throw`,
 * and the swallowed exit status. `stopBrowser` is what the `finally` blocks call, and it waits.
 */
function killBrowser(proc, group, signal = 'SIGTERM') {
  try {
    if (process.platform === 'win32') {
      // /t = the child processes, /f = no grace period. Spawned, not awaited: a failing taskkill
      // reports through its exit code, and nothing here may throw into a `finally`.
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    process.kill(group ? -proc.pid : proc.pid, signal);
  } catch {
    /* already gone */
  }
}

/** Whether a spawned process has ended, polled rather than slept through. */
async function exited(proc, budgetMs) {
  const started = Date.now();
  for (;;) {
    if (proc.exitCode !== null || proc.signalCode !== null) return true;
    if (Date.now() - started >= budgetMs) return false;
    await sleep(100);
  }
}

/**
 * Stop a browser and WAIT until it is gone, killing what ignores the signal.
 *
 * The blind 1.5 s that used to follow `killBrowser` was a guess, and a browser that outlived it kept
 * the DevTools port: the next scenario's `/json/new` was then answered by THAT browser, so the tab it
 * opened was never in the tabs the bridge listed, and ui-pages.mjs read the accent of a browser nobody
 * was testing — measured on issue #52, where the endpoint answered 13 ms after the spawn, long before
 * any new browser could be listening. So the wait is on the process, not on a clock, and a browser
 * that will not go is killed rather than left holding the port.
 */
async function stopBrowser(proc, group) {
  killBrowser(proc, group);
  if (await exited(proc, 10_000)) return;
  killBrowser(proc, group, 'SIGKILL');
  await exited(proc, 5_000);
}

/** Whether something of ours is still listening on a loopback port. */
function listening(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.on('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.on('error', () => done(false));
    socket.on('timeout', () => {
      socket.destroy();
      done(false);
    });
  });
}

/**
 * Wait until the ports a browser of this run owns are free, and report the ones that stayed busy.
 *
 * Every browser here shares two ports (Chromium's DevTools endpoint, Firefox's BiDi), so a browser
 * left behind — a run interrupted with Ctrl-C, a crash before the `finally` — keeps answering for the
 * next one, silently: the run would measure another browser's tabs and another browser's pages.
 * Killing it is not this file's business (it cannot tell an orphan from the person's browser), so
 * the run waits for the port and names it when the wait runs out.
 */
async function portsFree(ports, budgetMs = 10_000) {
  const started = Date.now();
  for (;;) {
    const answers = await Promise.all(ports.map(listening));
    const busy = ports.filter((_, i) => answers[i]);
    if (!busy.length) return [];
    if (Date.now() - started >= budgetMs) return busy;
    await sleep(250);
  }
}

/**
 * The error lines a browser process printed, in memory. Some checks have nothing else to look at —
 * a screenshot that works answers with an image and no words — so "the browser logged nothing while
 * it was taken" is measured from the browser itself rather than assumed.
 *
 * `launch` calls this on every browser it starts, whatever the scenario below wants of it: the
 * streams are piped (that is the only way to read them), and a pipe nobody drains fills up and
 * blocks the browser halfway through the run. Call it again for a counter of your own — both
 * listeners see every chunk.
 */
function captureOutput(proc) {
  const errors = [];
  let tail = '';
  const keep = (chunk) => {
    // A line can arrive in two chunks: the piece before the last newline waits for the next one.
    const lines = (tail + String(chunk)).split('\n');
    tail = lines.pop() ?? '';
    for (const line of lines) if (BROWSER_ERROR.test(line)) errors.push(line.trim());
  };
  proc.stdout?.on('data', keep);
  proc.stderr?.on('data', keep);
  return { errors: () => [...errors] };
}

async function launch(browser, profile) {
  const url = `${ALLOWED}/fixture`;
  // First, before a process of ours exists: the ports this run shares have to be free, or a browser
  // left over from an earlier run answers for the one we are about to start (issue #52 — measured:
  // `/json/new` said yes 13 ms after the spawn, before a new browser could be listening).
  const busy = await portsFree([DEVTOOLS_PORT, BIDI_PORT]);
  if (busy.length)
    console.log(
      `  · [${browser}] port ${busy.join(', ')} was still busy — a browser from an earlier run may answer for this one`,
    );
  if (browser === 'chromium') {
    const bin = chromiumBinary();
    if (!bin) throw new Error('no Chromium that loads unpacked extensions — set BEIFAHRER_E2E_CHROMIUM');
    const ext = join(ROOT, 'extension/.output-e2e/chrome-mv3');
    const proc = spawn(
      bin,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        `--load-extension=${ext}`,
        `--disable-extensions-except=${ext}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(LANG ? [`--lang=${LANG}`] : []),
        // Always, not only with BEIFAHRER_E2E_LOGS: a call that WORKS says nothing beyond its
        // answer, so "did the browser log an error while this ran" (issue #5's screenshot) can only
        // be measured from the browser's own output — and `--v=0` keeps it to one line per message,
        // so what it adds is small and bounded.
        '--enable-logging=stderr',
        '--v=0',
        // Headless Chromium refuses a second start URL ("Multiple targets are not supported"),
        // so the forbidden-origin tab is opened over the DevTools endpoint once it is up.
        `--remote-debugging-port=${DEVTOOLS_PORT}`,
        url,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        // Chromium on Linux takes its UI language from LANGUAGE, not only from --lang.
        env: LANG ? { ...process.env, LANGUAGE: LANG } : process.env,
      },
    );
    captureOutput(proc);
    return proc;
  }
  const firefox = firefoxBinary();
  const webExt = localBin('web-ext', ROOT);
  const started = spawn(
    webExt.command,
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
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: webExt.shell },
  );
  captureOutput(started);
  return started;
}

/**
 * The `XDG_CONFIG_HOME` a run hands to the app, so a person's own recipes stay out of it.
 *
 * Asked of the app's own `configDir()` rather than spelled out here, which is the whole point: the
 * driver and the bridge resolve the config directory through the same function, so a change to one
 * cannot silently stop applying to the other. With `$XDG_CONFIG_HOME` set it wins on every
 * platform, and the assertion keeps that true.
 */
function throwawayConfigHome(tokenFile) {
  const home = join(dirname(tokenFile), 'config');
  if (!configDir({ XDG_CONFIG_HOME: home }).startsWith(home)) {
    throw new Error(`the app would read its config outside the throw-away profile (${home})`);
  }
  return home;
}

/**
 * The command that runs the bridge bundle on the runtime the run chose: `gjsify run …` on GJS,
 * plain `node …` on Node. The SDK spawns through `cross-spawn` with `shell: false` fixed, and
 * cross-spawn is what resolves a `node_modules/.bin` shim on Windows (it re-runs a `.cmd`
 * through cmd.exe) — so here only the FILE NAME may be corrected; no `shell` option exists.
 */
function bridgeCommand() {
  if (BRIDGE_RUNTIME === 'node') return { command: process.execPath, args: [BRIDGE_BUNDLE], shell: false };
  const gjsify = localBin('gjsify', ROOT);
  return { command: gjsify.command, args: ['run', BRIDGE_BUNDLE], shell: gjsify.shell };
}

/** Start one `beifahrer mcp` over stdio, as an agent session would. */
async function startMcp(tokenFile, logName, env = {}) {
  const { command, args: launch } = bridgeCommand();
  const transport = new StdioClientTransport({
    command,
    args: [
      ...launch,
      'mcp',
      '--port',
      String(RANGE.base),
      '--port-count',
      String(RANGE.count),
      '--allow-write',
    ],
    // Recipes from the test's own directory; XDG_CONFIG_HOME inside the throw-away profile so the
    // person's own recipes never take part. It is the ONE variable the app's configDir() honours on
    // every platform (packages/local/src/config-dir.ts), so this fake is enough on all of them — and the
    // assertion below is what makes "enough" checked rather than assumed.
    env: {
      ...process.env,
      BEIFAHRER_TOKEN_FILE: tokenFile,
      XDG_CONFIG_HOME: throwawayConfigHome(tokenFile),
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

/**
 * Why a check on the tab on the site nobody allowed could not run.
 *
 * That tab is opened over the DevTools endpoint while the browser is still coming up (see
 * `openForbiddenTab`), so it can be late — and it was sometimes never there at all. Reading
 * `forbidden.tabId` then threw a `TypeError` that took the WHOLE scenario with it: 143 checks never
 * ran, for one missing tab (issue #52). So every check that needs the tab keeps its own assertion
 * and fails on THIS instead, which says why — the group is reported, never thrown away.
 */
const NO_TAB = {
  error: true,
  content: [],
  text: 'no tab on the site nobody allowed: the browser never opened one (see the tabs_list check)',
};

/** The call a check on that tab makes — or the reason it could not make one. */
const onForbidden = (forbidden, call) => (forbidden ? call(forbidden.tabId) : Promise.resolve(NO_TAB));

/**
 * The tab on the site nobody allowed, opened over the DevTools endpoint, and what the endpoint said.
 *
 * Headless Chromium takes one start URL (a second one makes it exit, see `launch`), so this tab has
 * to be opened through `/json/new` — while the browser is still starting, since the endpoint answers
 * before anything else is ready. What the old loop did not do was LOOK at the answer, so a tab that
 * never appeared showed up far later as one check failing with no reason. The last answer is
 * returned for exactly that, and is what the checks on the tab report.
 */
async function openForbiddenTab(devtoolsPort, url) {
  const started = Date.now();
  let last = 'never answered';
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?${url}`, { method: 'PUT' }).then(
      (res) => ({ ok: res.ok, status: res.status }),
      (err) => ({ ok: false, status: String(err?.cause?.code ?? err?.message ?? err) }),
    );
    if (r.ok) return `opened after ${Date.now() - started} ms`;
    last = r.status;
    await sleep(250);
  }
  return `not opened (${last})`;
}

/** `beifahrer tool <name>` as a separate process: binds its own port and waits for the browser. */
function runTool(tokenFile, name, args = {}) {
  return new Promise((resolveRun) => {
    // The same runtime as every other bridge in the run: on a Node host this check must not be
    // the one place that quietly needs gjsify on PATH.
    const { command, args: launch, shell } = bridgeCommand();
    const child = spawn(
      command,
      [
        ...launch,
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
        shell,
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
        if (res.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
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
  const proc = await launch(browser, profile);
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
    // Issue #28: this close was the person's decision, so both the list and the next call have to
    // say so — read as "the browser went away", an agent retries, and retrying past a dismissal is
    // what ADR 0005 exists to prevent.
    check(
      name,
      'browsers_list names the dismissal as the person, not as a browser that went away',
      stillGone.disconnected?.by === 'person',
      JSON.stringify(stillGone).slice(0, 200),
    );
    check(
      name,
      'the refused call names the person and does not suggest retrying',
      refused.error && /disconnected because the person disconnected this session/.test(refused.text),
      refused.text.slice(0, 200),
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
    check(
      name,
      'the new bridge instance carries no cause over from the one the person dismissed',
      sd.disconnected === undefined,
      JSON.stringify(sd).slice(0, 200),
    );
  } finally {
    for (const s of sessions) await s.client.close().catch(() => undefined);
    old.server.close();
    await stopBrowser(proc, browser === 'firefox');
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

/** `access_check`'s answer as an object; a refusal has no JSON to parse, so it answers empty. */
function accessAnswer(call) {
  try {
    return JSON.parse(call.text);
  } catch {
    return {};
  }
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
  const proc = await launch(browser, profile);
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
    await stopBrowser(proc, browser === 'firefox');
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * Issue #5: the confirmation window, answered as the person answers it.
 *
 * Every other build silences confirmation for the fixture site (`confirmWrites: false`), so no run
 * proves what happens when it is ON — which is the state a person is in by default, and the one
 * every write passes through. This build leaves the site's rule at the default, so the window opens,
 * and the E2E hook answers it as Allow or Deny would (e2e-seed.ts). The two-minute timeout is not
 * waited out on purpose: it would add two minutes to the run to prove what Deny already proves, and
 * the extension answers both the same way (`denied:`, confirm.ts).
 *
 * Every write gets its own hook tab — the person answers EVERY window, so one tab that answered
 * once and then carried on would prove nothing about the second one (ADR 0012's script run).
 *
 * The same build carries the screenshot refusal for the MISSING `<all_urls>` grant: the switch is
 * on and the grant is off, which is the only combination in which that refusal is reachable.
 */
async function confirmScenario(browser) {
  const name = `${browser} confirm`;
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-confirm-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const a = await startMcp(tokenFile, `${browser}-confirm-a.log`, {
    BEIFAHRER_SESSION_LABEL: 'e2e confirm',
  });
  const proc = await launch(browser, profile);
  /** The write runs; the person answers the window it opened, as they would. */
  const answered = async (pending, answer) => {
    await sleep(1_000);
    await tool(a.client, 'tab_open', {
      url: `${ALLOWED}/__beifahrer_e2e/confirm?answer=${answer}`,
      active: false,
    });
    return Promise.race([pending, sleep(20_000).then(() => null)]);
  };
  try {
    await until(a.client, (s) => s.browsers?.length === 1, 60);

    // The tab the writes go into is opened here and left ACTIVE: a screenshot has to be of the tab
    // on screen, and beifahrer will not switch the person's tab to get one.
    const opened = await tool(a.client, 'tab_open', { url: `${ALLOWED}/fixture` });
    const tabId = opened.error ? null : JSON.parse(opened.text).tab?.tabId;
    if (tabId == null) {
      check(name, 'the fixture tab opened', false, opened.text.slice(0, 200));
      return;
    }
    await tool(a.client, 'page_wait', { tabId, for: 'load' });
    const outline = await tool(a.client, 'page_outline', { tabId });
    const ref = (label) => new RegExp(`\\[(e\\d+)\\] [a-z]+ "${label}`).exec(outline.text)?.[1];
    const note = ref('Gate note');
    const save = ref('Gate save');
    if (!note || !save) {
      check(name, 'page_outline gives refs for the gate field and button', false, outline.text.slice(0, 400));
      return;
    }
    // What gates the writes below, asked before any of them: this build does not silence the
    // person, so a write here is served WITH a window. Getting `confirm` wrong in either direction
    // would misreport the site to every agent that asks (the `on` build checks the other half).
    const would = await tool(a.client, 'access_check', { method: 'page.click', tabId });
    const wouldSay = accessAnswer(would);
    check(
      name,
      'access_check says a click here would be served, and that the person is asked',
      !would.error && wouldSay.allowed === true && wouldSay.stage === 'ok' && wouldSay.confirm === true,
      would.text.replace(/\s+/g, ' ').slice(0, 220),
    );

    // A screenshot here is refused — the switch is on, the grant is not — and it has to be a clear
    // refusal, not a hang or a bare error (the `on` build is the one that has to prove the image).
    const noGrant = await quickly(a.client, 'page_screenshot', { tabId });
    check(
      name,
      'a screenshot without the <all_urls> grant is refused, and says what is missing',
      noGrant.error &&
        noGrant.text.startsWith('forbidden:') &&
        /screenshots are switched off|Screenshots need the extra "all sites" grant/.test(noGrant.text),
      noGrant.text.slice(0, 240),
    );

    // Allow: the fill lands, and the PAGE says so — the gate opens because the page's own listener
    // saw the text, which is the difference between "the call returned" and "the page changed".
    const filled = await answered(tool(a.client, 'page_fill', { tabId, ref: note, text: 'open' }), 'allow');
    const afterAllow = await tool(a.client, 'page_read', { tabId });
    check(
      name,
      'a write the person allowed goes through, and the page changed',
      !!filled &&
        !filled.error &&
        afterAllow.text.includes('gate:enabled') &&
        !afterAllow.text.includes('gate:disabled'),
      `${String(filled?.text).slice(0, 200)} | ${afterAllow.text.slice(-400)}`,
    );

    // Deny: the same click on the button the fill enabled. The answer is `denied:` and the page's
    // own `saved:` line stays empty — a window that was answered Deny and still changed something.
    const deniedCall = answered(tool(a.client, 'page_click', { tabId, ref: save }), 'deny');
    const refused = await deniedCall;
    const afterDeny = await tool(a.client, 'page_read', { tabId });
    check(
      name,
      'a write the person denied answers "denied"',
      !!refused && refused.error && String(refused.text).startsWith('denied:'),
      refused ? String(refused.text).slice(0, 200) : 'still waiting after 20 s',
    );
    check(
      name,
      'and the page did NOT change',
      !afterDeny.text.includes('saved:') && afterDeny.text.includes('gate:enabled'),
      afterDeny.text.slice(-400),
    );

    // The same click, allowed: the window is the only thing between the two answers.
    const allowed = await answered(tool(a.client, 'page_click', { tabId, ref: save }), 'allow');
    const afterSaved = await tool(a.client, 'page_read', { tabId });
    check(
      name,
      'the same write, answered Allow, lands in the page',
      !!allowed && !allowed.error && afterSaved.text.includes('saved:open'),
      `${String(allowed?.text).slice(0, 200)} | ${afterSaved.text.slice(-400)}`,
    );
  } finally {
    await a.client.close().catch(() => undefined);
    await stopBrowser(proc, browser === 'firefox');
    rmSync(profile, { recursive: true, force: true });
  }
}
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
 * Issue #32: a frame gets its own origin in the policy, so the agent can see what the person
 * allowed — and nothing else.
 *
 * The check that matters is not "did the agent get into the frame". It is **where a click landed**:
 * a ref is `e12` in one document and `b2e12` in another, and if the routing were wrong the click
 * would hit a DIFFERENT element in a different document. So every write here is verified by the
 * page's own counter, in the frame that was supposed to change, and the top document's own counter
 * is checked afterwards to prove nothing moved there.
 *
 * The negative case is the security one. `localhost` is at `none` in this build, and the page embeds
 * a frame from it. The page is allowed; the frame is not. A frame on a blocked origin must therefore
 * be invisible — in the outline, in `read`, in `find` — even though everything around it is readable.
 * That is what `all_frames` in a manifest would have broken silently, and it is the whole reason
 * #30 stopped at same-origin frames.
 */

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

/**
 * `page_expect` (issue #35): a condition, the wait for it, and — the reason the method exists — the
 * report a FAILED assertion gives.
 *
 * Every case is measured on the PAGE as well as in the answer: a condition that held and a call that
 * returned look the same from the outside, and a wait is only a wait if the page moved on its own
 * while nobody was looking. The answers are logged whole, because a red check here is worth nothing
 * without the string it printed.
 */
async function assertions(browser, client, allowed, _ref) {
  const ask = async (label, args) => {
    const r = await tool(client, 'page_expect', { tabId: allowed.tabId, ...args });
    // The diagnosable channel: `check` clips its detail to a line, and this is the line that says
    // what the page looked like.
    console.log(`  · [${browser}] ${label} → error=${r.error} ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    return r;
  };
  const json = (r) => {
    try {
      return JSON.parse(r.text);
    } catch {
      return {};
    }
  };
  // Refs from a FRESH outline rather than the one the scenario started with: a ref is a fact about
  // this document, and asking for it again costs one call and removes a stale-namespace guess.
  const fresh = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 400 });
  const refOf = (label) => new RegExp(`\\[(e\\d+)\\] [a-z]+ "${label}`).exec(fresh.text)?.[1];

  // --- a condition that does not hold yet ------------------------------------------------------
  // The button starts `disabled` and the PAGE's own input listener is what opens it. So a `pass`
  // here could only come from the page: beifahrer does not and cannot enable a control.
  const off = await ask('gate save enabled (before)', {
    role: 'button',
    name: 'Gate save',
    state: 'enabled',
    timeoutMs: 600,
  });
  const offJson = json(off);
  check(
    browser,
    'a condition that does not hold fails instead of erroring, and says what it saw',
    !off.error && offJson.pass === false && /disabled/.test(offJson.seen ?? ''),
    off.text.replace(/\s+/g, ' ').slice(0, 300),
  );
  check(
    browser,
    'and the failure names what was wanted, so it can be acted on',
    /Gate save/.test(offJson.expected ?? '') && /enabled/.test(offJson.expected ?? ''),
    offJson.expected ?? off.text.slice(0, 200),
  );
  check(
    browser,
    'the page itself reported the button as disabled, so that was not a bad query',
    /gate:disabled/.test(await outputOf(client, allowed)),
    (await outputOf(client, allowed)).match(/gate:\w+/)?.[0] ?? '',
  );

  // --- the same condition, after the page opened it ---------------------------------------------
  const note = refOf('Gate note');
  const opened = await tool(client, 'page_fill', { tabId: allowed.tabId, ref: note, text: 'open' });
  const on = await ask('gate save enabled (after fill)', {
    role: 'button',
    name: 'Gate save',
    state: 'enabled',
  });
  const onJson = json(on);
  check(
    browser,
    'the fill reached the page (its own listener opened the gate), and the assertion now holds',
    !opened.error && !on.error && onJson.pass === true,
    `${opened.text.replace(/\s+/g, ' ').slice(0, 120)} | ${on.text.replace(/\s+/g, ' ').slice(0, 200)}`,
  );
  check(
    browser,
    'and the page agrees: its own report changed to enabled',
    /gate:enabled/.test(await outputOf(client, allowed)),
    (await outputOf(client, allowed)).match(/gate:\w+/)?.[0] ?? '',
  );

  // --- a value, exactly ------------------------------------------------------------------------
  const held = await ask('gate note holds "open"', { ref: note, value: 'open' });
  check(
    browser,
    'a value is asserted exactly, and what the field holds passes',
    !held.error && json(held).pass === true,
    held.text.replace(/\s+/g, ' ').slice(0, 200),
  );
  const wrong = await ask('gate note holds "shut"', { ref: note, value: 'shut', timeoutMs: 900 });
  const wrongJson = json(wrong);
  check(
    browser,
    'a value that is not there fails WITH the value that is — the reason the method exists',
    !wrong.error && wrongJson.pass === false && /"open"/.test(wrongJson.seen ?? ''),
    wrong.text.replace(/\s+/g, ' ').slice(0, 200),
  );

  // --- a ref and a count are two different questions -------------------------------------------
  const counted = await ask('count with a ref', { ref: note, count: 1 });
  check(
    browser,
    'count with a ref is refused: a ref is one element, and "count: 0" on it would pass',
    counted.error && /ref is one element/.test(counted.text),
    counted.text.replace(/\s+/g, ' ').slice(0, 200),
  );

  // --- text, as a substring --------------------------------------------------------------------
  const said = await ask('gate save says save', { role: 'button', name: 'Gate save', text: 'save' });
  const unheard = await ask('gate save says apply', {
    role: 'button',
    name: 'Gate save',
    text: 'Apply',
    timeoutMs: 900,
  });
  const unheardJson = json(unheard);
  check(
    browser,
    'text is a substring of what the element says, and the failure quotes what it says',
    !said.error &&
      json(said).pass === true &&
      !unheard.error &&
      unheardJson.pass === false &&
      /Gate save/.test(unheardJson.seen ?? ''),
    `${said.text.replace(/\s+/g, ' ').slice(0, 120)} | ${unheard.text.replace(/\s+/g, ' ').slice(0, 200)}`,
  );

  // --- count, and the absence a caller asks for ------------------------------------------------
  const one = await ask('one gate save', { role: 'button', name: 'Gate save', count: 1 });
  const none = await ask('no button called Nothing', { role: 'button', name: 'Nothing', count: 0 });
  const some = await ask('two gate saves', { role: 'button', name: 'Gate save', count: 2, timeoutMs: 900 });
  check(
    browser,
    'count: 0 on a query that matches nothing passes, and count: 1 on the one that does',
    !one.error && json(one).pass === true && !none.error && json(none).pass === true,
    `${one.text.replace(/\s+/g, ' ').slice(0, 120)} | ${none.text.replace(/\s+/g, ' ').slice(0, 120)}`,
  );
  check(
    browser,
    'a count that is wrong fails and reports the number it found',
    !some.error && json(some).pass === false && /found 1/.test(some.text),
    some.text.replace(/\s+/g, ' ').slice(0, 200),
  );

  // --- the wait: the page's own timer, and nobody watching --------------------------------------
  // The click brings the spinner back and the page hides it again 3 s later. So an assertion on
  // "hidden" has to WAIT: it cannot pass on the click and it must not fail on the spinner either.
  // The page's own report of which of the two it is in is read BEFORE the assertion, because a click
  // that took longer than the spinner (a confirmation window on one engine, nothing on the other)
  // would make this check pass for the wrong reason — and measured, that is what happened.
  const saveRef = refOf('Gate save');
  const clicked = await tool(client, 'page_click', { tabId: allowed.tabId, ref: saveRef });
  const justAfter = await outputOf(client, allowed);
  check(
    browser,
    'the click put the spinner on screen, and the page says so',
    !clicked.error && /spin:shown/.test(justAfter),
    justAfter.match(/spin:\w+/)?.[0] ?? justAfter.slice(0, 200),
  );
  const spinner = await ask('spinner gone', {
    role: 'button',
    name: 'Spinning',
    state: 'hidden',
    timeoutMs: 10_000,
  });
  const spinnerJson = json(spinner);
  check(
    browser,
    'a condition the page satisfies later is waited for, not sampled once',
    !spinner.error && spinnerJson.pass === true && spinnerJson.waitedMs >= 500,
    `waitedMs=${spinnerJson.waitedMs} | ${spinner.text.replace(/\s+/g, ' ').slice(0, 200)}`,
  );
  const afterWait = await outputOf(client, allowed);
  check(
    browser,
    'and the page really did go on and hide it, so the wait saw a change',
    /spin:hidden/.test(afterWait) && !/Spinning/.test(afterWait) && /saved:open/.test(afterWait),
    afterWait
      .match(/[^\n]*(spin:|saved:|Spinning)[^\n]*/g)
      ?.slice(0, 3)
      .join(' | ') ?? '',
  );

  // A second run finds it already gone, so it must not wait again.
  const again = await ask('spinner gone (again)', {
    role: 'button',
    name: 'Spinning',
    state: 'hidden',
    timeoutMs: 4000,
  });
  check(
    browser,
    'a condition that already holds answers at once, without burning the timeout',
    !again.error && json(again).pass === true && json(again).waitedMs < 400,
    again.text.replace(/\s+/g, ' ').slice(0, 200),
  );

  // --- a blocked frame satisfies nothing -------------------------------------------------------
  // The frame on localhost holds a button the person never allowed. An assertion must not be able to
  // find it — otherwise "is it still there?" would be answered by a frame the policy hides.
  const foreign = await ask('foreign frame button visible', {
    role: 'button',
    name: 'Foreign frame button',
    state: 'visible',
    timeoutMs: 600,
  });
  check(
    browser,
    'a frame on a blocked origin cannot satisfy an assertion',
    !foreign.error && json(foreign).pass === false,
    foreign.text.replace(/\s+/g, ' ').slice(0, 200),
  );

  // --- the same condition, answered by the frame ------------------------------------------------
  // "Frame act" only exists inside the allowed frame, so the deciding document is that frame and the
  // answer has to say so — otherwise a failure there reads as a statement about the page.
  const inFrame = await ask('frame act visible', { role: 'button', name: 'Frame act', state: 'visible' });
  const inFrameJson = json(inFrame);
  check(
    browser,
    'a condition that only a frame can satisfy passes, and the answer names that frame',
    !inFrame.error && inFrameJson.pass === true && inFrameJson.frame >= 1,
    `frame=${inFrameJson.frame} | ${inFrame.text.replace(/\s+/g, ' ').slice(0, 200)}`,
  );

  // A ref into a frame routes to that document, like any other ref'd call.
  const frameAct = [...fresh.text.matchAll(/\[(b\d+e\d+)\] button "Frame act"/g)].map((m) => m[1])[0];
  if (frameAct) {
    const viaRef = await ask(`frame ref ${frameAct}`, { ref: frameAct, state: 'visible' });
    const viaRefJson = json(viaRef);
    check(
      browser,
      'a ref inside a frame is asserted in THAT frame, and the answer says which',
      !viaRef.error && viaRefJson.pass === true && viaRefJson.frame === Number(frameAct.match(/^b(\d+)/)[1]),
      `ref=${frameAct} frame=${viaRefJson.frame} | ${viaRef.text.replace(/\s+/g, ' ').slice(0, 200)}`,
    );
  } else {
    check(
      browser,
      "the frame's button has a namespaced ref for the ref assertion",
      false,
      fresh.text.replace(/\s+/g, ' ').slice(0, 400),
    );
  }

  // --- refusals: an assertion with nothing to assert -------------------------------------------
  for (const [label, args, why] of [
    ['neither a ref nor a query', { state: 'visible' }, /needs a ref or a query/],
    ['both a ref and a query', { ref: note, role: 'button', state: 'visible' }, /not both/],
    ['nothing to check', { role: 'button', name: 'Gate save' }, /needs a state, a value, a text or a count/],
  ]) {
    const r = await ask(label, args);
    check(
      browser,
      `page_expect with ${label} is refused: ${why}`,
      r.error && why.test(r.text),
      r.text.replace(/\s+/g, ' ').slice(0, 200),
    );
  }
}

/**
 * `page_network` (issue #35): what an agent has instead of a page's console, which no extension can
 * read at all.
 *
 * Measured on the PAGE, not on the return value: the fixture asks for `/api/ping` on load and POSTs
 * `/api/submit` when the gate is clicked, and the server answers the second one with 500 — so the log
 * has to show a query that went out, a POST that came back broken, and a URL whose query is NOT in the
 * answer although the page sent one.
 */
async function requests(browser, client, allowed, forbidden, ref) {
  const ask = async (label, args = {}) => {
    const r = await tool(client, 'page_network', { tabId: allowed.tabId, ...args });
    console.log(`  · [${browser}] ${label} → error=${r.error} ${r.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    return r;
  };
  const json = (r) => {
    try {
      return JSON.parse(r.text);
    } catch {
      return {};
    }
  };

  // The POST has to be in the log before it is asked about, so the click comes first.
  const gate = ref('Gate save');
  const clicked = await tool(client, 'page_click', { tabId: allowed.tabId, ref: gate });
  await sleep(700);

  const log = await ask('after the click');
  const rows = json(log).requests ?? [];
  const ping = rows.find((row) => row.url.endsWith('/api/ping'));
  const submit = rows.find((row) => row.url.endsWith('/api/submit'));
  check(
    browser,
    'page_network answers, and the log is a list rather than a string',
    !clicked.error && !log.error && Array.isArray(rows) && rows.length > 0,
    log.text.replace(/\s+/g, ' ').slice(0, 300),
  );
  check(
    browser,
    "the page's own request is in it, with the method and the browser's type",
    !!ping && ping.method === 'GET' && /xmlhttprequest/.test(ping.type ?? ''),
    JSON.stringify(ping ?? null),
  );
  check(
    browser,
    'a request that came back with a status carries it, and the method the page used',
    !!submit && submit.method === 'POST' && submit.status === 500 && submit.pending === false,
    JSON.stringify(submit ?? null),
  );
  check(
    browser,
    'and the query string is NOT in the answer, although the page sent one',
    // The page asked for `?token=e2e-secret`. A log that handed that over would put a session token
    // in the agent's hands, and the person never got to look at it.
    !!ping && !/token/.test(log.text) && !rows.some((row) => row.url.includes('?')),
    rows
      .slice(0, 6)
      .map((row) => row.url)
      .join(' | '),
  );
  // The boundary that matters, and the one that is not a detail: a request log is as much about the
  // site's tab as its text is, so a tab on a site nobody allowed has none to ask about. (The document
  // request that LOADED this page is in no log at all — the extension's watch begins with the
  // extension, and a page the browser was already showing asked nothing since. That is honest.)
  const blocked = await onForbidden(forbidden, (tabId) => tool(client, 'page_network', { tabId }));
  check(
    browser,
    'a tab on a site nobody allowed has no request log to ask about',
    blocked.error && blocked.text.startsWith('forbidden:'),
    blocked.text.slice(0, 200),
  );
  // And the log says how much it holds, so "these 50 of 200" is visible rather than implied.
  const whole = json(await ask('the whole log', { limit: 200 }));
  check(
    browser,
    "the answer says how much the tab's log holds, so a tail is not mistaken for everything",
    typeof whole.kept === 'number' && whole.kept > 0 && typeof whole.truncated === 'boolean',
    `kept=${whole.kept} truncated=${whole.truncated}`,
  );

  // `since` is the question behind "what has it done since I clicked", and it is the only way to keep
  // a log from being read from the beginning every time.
  const mark = Date.now();
  await tool(client, 'page_click', { tabId: allowed.tabId, ref: gate });
  await sleep(700);
  const fresh = await ask('since the click', { since: mark });
  const freshRows = json(fresh).requests ?? [];
  check(
    browser,
    'since returns only what came after it, which is the click and nothing older',
    freshRows.length > 0 &&
      freshRows.every((row) => row.at > mark) &&
      !freshRows.some((row) => row.url.endsWith('/api/ping')),
    freshRows
      .slice(0, 6)
      .map((row) => `${row.method} ${row.url}`)
      .join(' | '),
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
  const onBlocked = await onForbidden(forbidden, (tabId) =>
    tool(client, 'page_navigate', { tabId, url: `${ALLOWED}/elsewhere` }),
  );
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

async function framesAndOrigins(browser, client, allowed) {
  // --- the same-origin frame, which the person allowed by allowing the page -------------------
  // Asked TWICE on purpose, and the second answer is the one under test. Whether the frames need
  // more than one call to appear is exactly the question this line settles: a frame section on the
  // second call but not the first means the announcements are late, while neither means the
  // injection is not reaching the frames at all. Two different fixes, and only one run to tell.
  const outline = await tool(client, 'page_outline', { tabId: allowed.tabId, maxItems: 400 });
  check(
    browser,
    'the frame has its own section, headed by its URL',
    !outline.error && /frame: [^\n]*\/frame-inside/.test(outline.text),
    outline.text.includes('framesUnavailable')
      ? 'FRAMES UNAVAILABLE: ' + /frames could not be reached[^\n]*/.exec(outline.text)?.[0]
      : outline.text.slice(0, 400),
  );
  const frameRefs = [...outline.text.matchAll(/\[(b\d+e\d+)\]/g)].map((m) => m[1]);
  check(
    browser,
    "and its refs are namespaced, so they cannot collide with the page's own",
    frameRefs.length > 0 && frameRefs.every((r) => /^b\d+e\d+$/.test(r)),
    `${frameRefs.length} refs: ${frameRefs.slice(0, 4).join(', ')}`,
  );
  // The two registries are separate, so the same local number can appear in both. That is the whole
  // reason for the prefix, and it is worth seeing in the output that it really happens.
  const pageRefs = [...outline.text.matchAll(/\[(e\d+)\]/g)].map((m) => m[1]);
  const sharedLocal = frameRefs.map((r) => r.replace(/^b\d+/, '')).filter((r) => pageRefs.includes(r));
  check(
    browser,
    'and the two documents really do reuse the same local numbers, which is why the prefix exists',
    sharedLocal.length > 0,
    `page: ${pageRefs.slice(0, 5).join(',')} | frame: ${frameRefs.slice(0, 5).join(',')}`,
  );

  // --- the negative case: a frame on a blocked origin -----------------------------------------
  check(
    browser,
    'a frame on a site the person blocked is invisible in the outline',
    !/frame-foreign/.test(outline.text) && !/Foreign frame button/.test(outline.text),
    outline.text.match(/[^\n]*frame-foreign[^\n]*/)?.[0] ?? 'nicht genannt',
  );
  const found = await tool(client, 'page_find', { tabId: allowed.tabId, name: 'Foreign frame button' });
  check(
    browser,
    'and in page_find, though the page around it is readable',
    !found.error && JSON.parse(found.text).count === 0,
    found.text.slice(0, 200),
  );
  const read = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 20_000 });
  check(
    browser,
    'and in page_read — a frame that is invisible in the walk but visible in the text would leak',
    !read.error && !/frame-foreign/.test(read.text) && !/Foreign frame button/.test(read.text),
    read.text.match(/[^\n]*frame-foreign[^\n]*/)?.[0] ?? read.text.slice(0, 200),
  );
  check(
    browser,
    'while the frame the person DID allow is in the read',
    /Text inside the frame document\./.test(read.text),
    read.text.slice(0, 200),
  );

  // --- a write into a frame: where did it land? -----------------------------------------------
  const before = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 20_000 });
  const act = [...outline.text.matchAll(/\[(b\d+e\d+)\] button "Frame act"/g)].map((m) => m[1])[0];
  if (!act) {
    check(browser, "the frame's button has a namespaced ref", false, outline.text.slice(0, 600));
    return;
  }
  const clicked = await tool(client, 'page_click', { tabId: allowed.tabId, ref: act });
  check(
    browser,
    'a namespaced ref clicks',
    !clicked.error,
    `ref=${JSON.stringify(act)} -> ${clicked.text.slice(0, 200)}`,
  );

  const after = await tool(client, 'page_read', { tabId: allowed.tabId, maxChars: 20_000 });
  check(
    browser,
    "and the click landed IN THE FRAME: the frame's own counter moved",
    /frame-acts:1/.test(after.text),
    after.text.match(/frame-acts:\d/)?.[0] ?? after.text.slice(0, 300),
  );
  check(
    browser,
    "and the page's own counter did NOT, so the ref did not resolve into the wrong document",
    /frame-clicks:0/.test(after.text) && before.text === after.text.replace('frame-acts:1', 'frame-acts:0'),
    after.text.match(/frame-clicks:\d/)?.[0] ?? after.text.slice(0, 300),
  );

  // --- a ref naming a frame that is not allowed -----------------------------------------------
  const wrong = await tool(client, 'page_click', { tabId: allowed.tabId, ref: 'b999e1' });
  check(
    browser,
    'a ref in a frame the person blocked names no element, rather than resolving somewhere',
    wrong.error,
    wrong.text.slice(0, 200),
  );
  const invented = await tool(client, 'page_click', { tabId: allowed.tabId, ref: 'b0e1' });
  check(
    browser,
    'and a frame number below 1 is refused: the page itself has no prefix',
    invented.error,
    invented.text.slice(0, 200),
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
      walled.error && walled.text.startsWith('unsupported:') && /cannot do page.evaluate/.test(walled.text),
      walled.text.slice(0, 240),
    );
    // Nothing below can happen here, and pretending otherwise would test a browser that does not
    // have the method: the gate that refuses is in the BRIDGE, ahead of every check in the
    // extension — ahead of the switch, the level and the window. That ordering is the point: an
    // agent is told the truest reason first ("this browser cannot"), not the next one in line.
    return;
  }

  // 1. Below the level: a site with no rule refuses a script, naming write.
  const onNothing = await onForbidden(forbidden, (tabId) =>
    quickly(client, 'page_evaluate', { tabId, script: 'return document.title' }),
  );
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
    main.error && main.text.startsWith('unsupported:') && /content security policy/.test(main.text),
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
    denied && denied.error && (denied.text ?? '').startsWith('denied:'),
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
    check(browser, 'the script read the page title', out.value?.title === 'Beifahrer fixture', ran.text);
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
    'a script can use the Beifahrer API',
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

  const deniedFind = await onForbidden(forbidden, (tabId) =>
    tool(client, 'page_find', { tabId, role: 'button' }),
  );
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

  const wrongTab = await onForbidden(forbidden, (tabId) =>
    tool(client, 'recipe_run', { tabId, id: 'openproject/add-comment', params: { text: 'x' } }),
  );
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
  const moved = await onForbidden(forbidden, (tabId) =>
    tool(client, 'tabs_move', { tabIds: [tabId], windowId: win, index: -1 }),
  );
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
    // The check itself is a method like any other: while paused, asking what would be allowed is
    // refused exactly like doing it, and that refusal is the answer (issue #27).
    ['access_check', { method: 'page.read', tabId: 1 }],
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
    ['page_expect', { tabId: 1, role: 'button', state: 'visible' }],
    ['page_network', { tabId: 1 }],
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

  const proc = await launch(browser, profile);
  const browserOut = captureOutput(proc);
  // Where the tab on the site nobody allowed came from: Chromium's DevTools endpoint (one start URL
  // only), Firefox's second `--start-url`. A tab that never arrives has to be able to say which.
  let openedOn =
    browser === 'chromium'
      ? await openForbiddenTab(DEVTOOLS_PORT, `${FORBIDDEN}/fixture`)
      : "the browser's second start URL";
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

    // ONE browser: a browser left over from an earlier run connects to this bridge as well, and then
    // the bridge may answer `tabs.list` from a browser nobody is testing — which looks exactly like a
    // tab that never arrived (issue #52). So this counts, and a second one fails here with its name.
    let browsersSeen = [];
    for (let i = 0; i < 60 && !browsersSeen.length; i++) {
      const r = await tool(client, 'browsers_list');
      browsersSeen = !r.error ? JSON.parse(r.text).browsers : [];
      if (!browsersSeen.length) await sleep(1000);
    }
    check(
      browser,
      'extension connects and pairs, and is the only browser that does',
      browsersSeen.length === 1,
      browsersSeen.map((b) => `${b.label} (since ${b.connectedAt ?? '?'})`).join(' | '),
    );
    if (!browsersSeen.length) return;
    if (gate === 'paused') return await pausedChecks(browser, client);
    const info = JSON.parse((await tool(client, 'browsers_list')).text).browsers[0];
    check(
      browser,
      `reports its engine (${info.label}, MV${info.manifestVersion})`,
      info.family === (browser === 'chromium' ? 'chromium' : 'firefox'),
    );

    // The two start pages, waited for as a CONDITION: the one on the site nobody allowed is opened
    // while the browser is still coming up, so it can arrive late. If a whole window passes without
    // it, the tab is asked for once more (the endpoint may have answered for a browser that was
    // already on its way out) and looked for again — and if it is still not there, the checks on it
    // report THAT (NO_TAB) instead of taking the scenario with them (issue #52).
    const forbiddenHost = `localhost:${FIXTURE_PORT}`;
    let tabs = [];
    for (let window = 0; window < 2; window++) {
      for (let i = 0; i < 20; i++) {
        tabs = JSON.parse((await tool(client, 'tabs_list')).text).tabs;
        if (tabs.some((t) => t.url?.startsWith(ALLOWED)) && tabs.some((t) => t.host === forbiddenHost)) break;
        await sleep(500);
      }
      if (tabs.some((t) => t.host === forbiddenHost)) break;
      if (browser !== 'chromium') break;
      openedOn += ` | asked again: ${await openForbiddenTab(DEVTOOLS_PORT, `${FORBIDDEN}/fixture`)}`;
    }
    const allowed = tabs.find((t) => t.url?.startsWith(ALLOWED));
    const forbidden = tabs.find((t) => t.host === forbiddenHost);

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
        // Issue #35: a request log is the furthest-reaching capability in the list, and `webRequest`
        // cannot be narrowed to a site — so it is off until the person grants the browser permission.
        ['page_network', { tabId: allowed.tabId }, 'See what a page requests'],
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
      // Issue #27: the refusals above were the person's answer, told afterwards. Asking FIRST is the
      // point of access_check, so here it must name the switch that is off rather than a level or a
      // site the agent could go and try to work around.
      const offShot = await tool(client, 'access_check', {
        method: 'page.screenshot',
        tabId: allowed.tabId,
      });
      const offShotAnswer = accessAnswer(offShot);
      check(
        browser,
        'access_check names the switch a refused method is behind, without being called',
        !offShot.error &&
          offShotAnswer.allowed === false &&
          offShotAnswer.stage === 'feature' &&
          offShotAnswer.feature === 'screenshot' &&
          offShotAnswer.featureOn === false,
        offShot.text.replace(/\s+/g, ' ').slice(0, 220),
      );
      // The extension's own pages, once per browser: they do not depend on the build's switches.
      if (browser === 'chromium')
        await chromiumPages(check, DEVTOOLS_PORT, process.env.BEIFAHRER_E2E_SCREENSHOTS);
      else await firefoxPages(check, BIDI_PORT, process.env.BEIFAHRER_E2E_SCREENSHOTS);
      return;
    }
    check(
      browser,
      'tabs_list shows the allowed tab with url + title',
      allowed?.title === 'Beifahrer fixture',
      JSON.stringify(tabs),
    );
    check(
      browser,
      'tabs_list shows the forbidden tab as host only (no url, no title)',
      forbidden && forbidden.url === undefined && forbidden.title === undefined && forbidden.level === 'none',
      // A tab that is not there has to name itself: which tabs WERE there, and what the browser was
      // told when it was asked to open this one (issue #52).
      `${JSON.stringify(forbidden) ?? 'undefined'} among ${JSON.stringify(tabs).slice(0, 400)} — opened: ${openedOn}`,
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
      pill.startsWith('+closed -') && !pill.includes('OPEN') && !reread.text.includes('Beifahrer is reading'),
      reread.text.slice(0, 400),
    );

    const denied = await onForbidden(forbidden, (tabId) => tool(client, 'page_read', { tabId }));
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

    const writeDenied = await onForbidden(forbidden, (tabId) =>
      tool(client, 'page_fill', { tabId, ref: 'e1', text: 'x' }),
    );
    check(
      browser,
      'page_fill on a site nobody allowed is forbidden',
      writeDenied.error && writeDenied.text.startsWith('forbidden:'),
      writeDenied.text,
    );

    // Issue #5: the screenshot that SUCCEEDS, on both engines. This build carries `<all_urls>` in
    // its manifest (`e2eAllUrls`), so what is left is the whole path: capture the window, hide the
    // pill, encode. It has to be the tab on screen — beifahrer refuses to switch the person's tab
    // for one — and which of the start tabs is active is up to the browser, so the tab to
    // photograph is opened here. The refusal for the MISSING grant is the confirm build's check:
    // the switch on, the grant off, the only combination in which that refusal is reachable.
    const front = await tool(client, 'tab_open', { url: `${ALLOWED}/fixture` });
    const frontTabId = front.error ? allowed.tabId : JSON.parse(front.text).tab.tabId;
    await tool(client, 'page_wait', { tabId: frontTabId, for: 'load' });
    const loggedBefore = browserOut.errors().length;
    const shot = await tool(client, 'page_screenshot', { tabId: frontTabId });
    const image = shot.content?.find((c) => c.type === 'image');
    const bytes = image ? Buffer.from(image.data ?? '', 'base64').length : 0;
    check(
      browser,
      'page_screenshot answers with an image, given the browser granted <all_urls>',
      !shot.error &&
        typeof image?.mimeType === 'string' &&
        image.mimeType.startsWith('image/') &&
        bytes > 1000,
      image ? `${image.mimeType}, ${bytes} bytes` : shot.text.slice(0, 200),
    );
    // A capture that fails says so in its answer; one that works leaves nothing to read but pixels,
    // so the browser's own output is where an error behind that picture would show.
    const logged = browserOut.errors().slice(loggedBefore);
    check(
      browser,
      'and the browser logged no error while taking it',
      logged.length === 0,
      logged.join(' | ').slice(0, 300),
    );

    await shadowDom(browser, client, allowed);
    await framesAndOrigins(browser, client, allowed);
    await keys(browser, client, allowed, ref);
    await assertions(browser, client, allowed, ref);
    await requests(browser, client, allowed, forbidden, ref);
    // Issue #27: the state that gates a call is the person's, and none of it was visible before the
    // call. So ask it, and check all three shapes an agent meets: a read that would be served, a
    // write with the confirmation this build's site rule has, and a site nobody allowed, which must
    // come back refused and askable rather than as a page worth opening.
    const wouldRead = await tool(client, 'access_check', { method: 'page.read', tabId: allowed.tabId });
    const readAnswer = accessAnswer(wouldRead);
    check(
      browser,
      'access_check says a read on the allowed tab would be served, and at which level',
      !wouldRead.error &&
        readAnswer.allowed === true &&
        readAnswer.stage === 'ok' &&
        readAnswer.have === 'write' &&
        readAnswer.need === 'read',
      wouldRead.text.replace(/\s+/g, ' ').slice(0, 220),
    );
    const wouldClick = await tool(client, 'access_check', { method: 'page.click', tabId: allowed.tabId });
    const clickAnswer = accessAnswer(wouldClick);
    check(
      browser,
      'access_check says a click there is served, and reports the confirmation as this build has it',
      // The seed gives this site `confirmWrites: false`, so THIS build does not ask. Getting
      // `confirm` wrong in either direction misreports the site to every agent that asks.
      !wouldClick.error &&
        clickAnswer.allowed === true &&
        clickAnswer.need === 'write' &&
        clickAnswer.confirm === false,
      wouldClick.text.replace(/\s+/g, ' ').slice(0, 220),
    );
    const wouldReadBlocked = await tool(client, 'access_check', { method: 'page.read', url: FORBIDDEN });
    const blockedAnswer = accessAnswer(wouldReadBlocked);
    check(
      browser,
      'access_check says a read on a site nobody allowed is refused, at the level step and askable',
      !wouldReadBlocked.error &&
        blockedAnswer.allowed === false &&
        blockedAnswer.stage === 'level' &&
        blockedAnswer.have === 'none' &&
        blockedAnswer.askable === true,
      wouldReadBlocked.text.replace(/\s+/g, ' ').slice(0, 220),
    );
    await navigation(browser, client, allowed, forbidden);
    await scripts(browser, client, allowed, forbidden);
    await recipes(browser, client, allowed, forbidden);
    await tabManagement(browser, client, forbidden);
  } finally {
    await client.close().catch(() => undefined);
    await stopBrowser(proc, browser === 'firefox');
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * Start order does not matter and a restart is picked up by itself: the browser runs first, no
 * bridge anywhere; a session starts and is found; it is killed outright (no close frame) and a new
 * one on the same port is found again; the same after a polite exit and after a long gap. Nobody
 * touches the popup in between.
 */
async function reconnectScenario(browser) {
  const name = `${browser} reconnect`;
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-reconnect-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const sessions = [];
  const proc = launch(browser, profile);
  try {
    await sleep(8000); // several probe rounds with nothing listening
    let current = await startMcp(tokenFile, `${browser}-reconnect-a.log`);
    sessions.push(current);
    const first = await until(current.client, (s) => s.browsers?.length === 1, 30);
    check(name, 'a session that starts after the browser is found', first.browsers?.length === 1);
    const port = first.port;

    const restart = async (how, letter, gapMs, seconds) => {
      const old = current;
      sessions.splice(sessions.indexOf(old), 1);
      if (how === 'kill') process.kill(old.transport.pid, 'SIGKILL');
      else await old.client.close();
      await sleep(gapMs);
      current = await startMcp(tokenFile, `${browser}-reconnect-${letter}.log`);
      sessions.push(current);
      const t0 = Date.now();
      const s = await until(current.client, (st) => st.browsers?.length === 1, seconds);
      check(
        name,
        `a session killed ${how === 'kill' ? 'hard' : 'politely'} and restarted after ${gapMs / 1000} s is found again, same port`,
        s.browsers?.length === 1 && s.port === port,
        `${((Date.now() - t0) / 1000).toFixed(1)} s ${JSON.stringify(s).slice(0, 160)}`,
      );
    };
    await restart('kill', 'b', 300, 20);
    await restart('close', 'c', 300, 20);
    await restart('kill', 'd', 20_000, 45);
  } finally {
    for (const s of sessions) await s.client.close().catch(() => undefined);
    killBrowser(proc, browser === 'firefox');
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------

const which = process.argv[2] ?? 'all';
const browsers = which === 'all' ? ['chromium', 'firefox'] : [which];
/** BEIFAHRER_E2E_ONLY=reconnect runs just that scenario (one build, no fixture scenarios). */
const ONLY = process.env.BEIFAHRER_E2E_ONLY;

const FRAME_FIXTURE = `<!doctype html><html><head><title>Frame document</title></head><body>
<h2>Editor frame</h2>
<p>Text inside the frame document.</p>
<label for="frame-note">Frame note</label><input id="frame-note">
<button id="frame-save">Frame save</button>
<button id="frame-done">Frame done</button>
<button id="frame-act">Frame act</button>
<p id="frame-output">frame-clicks:0</p>
<p id="frame-act-output">frame-acts:0</p>
<script>
  let n = 0;
  document.getElementById('frame-done').addEventListener('click', () => {
    document.getElementById('frame-output').textContent = 'frame-clicks:' + ++n;
  });
  let m = 0;
  document.getElementById('frame-act').addEventListener('click', () => {
    document.getElementById('frame-act-output').textContent = 'frame-acts:' + ++m;
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
  // Issue #35: the two API paths, before anything is HTML. `/api/submit` answers 500 on purpose —
  // a failing POST with a status is the row an agent is looking for, and a page that answered 200
  // everywhere could not tell "the request went out" from "the request worked".
  if (req.url?.startsWith('/api/ping')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.url?.startsWith('/api/submit')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"ok":false}');
    return;
  }
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

// Five builds: the person's switches can only be flipped in the browser's UI, which a headless
// test cannot click. `off` has the default features (tab management, sessions, screenshots off);
// `on` carries PR #8's stored `grants.manageTabs` (which must still switch tab management AND
// sessions on) plus screenshots; `paused` is stopped; `confirm` does not silence the person.
const BUILDS = {
  off: seed,
  on: {
    ...seed,
    grants: { manageTabs: true },
    // ADR 0012: the script switch is one of the far-reaching capabilities, so `on` turns it on
    // deliberately — the person would have to do exactly this in their own options page.
    // Issue #35: the network switch on, and the browser's `webRequest` grant in the manifest — a
    // test cannot click a permission prompt, and the `off` build below is the one that has to prove
    // the refusal. `e2eApiPermissions` is only read by the e2e build (manifest.ts).
    features: { screenshot: true, script: true, network: true },
    e2eApiPermissions: ['webRequest'],
    // Issue #5: the extra "all sites" grant a screenshot needs and a test cannot click — Chromium's
    // `captureVisibleTab` accepts nothing narrower, Firefox does not even define it without. With
    // it, this build has to return an actual image; the refusal for its absence is `confirm`'s.
    e2eAllUrls: true,
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
  // Issue #5: confirmation NOT switched off — the default the person is in, and the only state in
  // which the window that every write passes through is ever open. `confirmWrites: false` is left
  // out of the site rule on purpose. No `e2eAllUrls`: the switch on and the grant off is the only
  // combination in which the screenshot's missing-grant refusal is reachable, and it needs the
  // switch on for that to be the reason.
  // Only the one switch this scenario needs on top of the defaults (reading a page, filling and
  // clicking in it and opening a tab are on by default), and no legacy `grants`: `on` is where PR #8's
  // stored switch is covered, and a second build on it would prove nothing new.
  confirm: {
    ...seed,
    policy: { origins: { [ALLOWED]: { level: 'write' } } },
    features: { screenshot: true },
  },
};
for (const [gate, build] of Object.entries(BUILDS)) {
  if (ONLY && gate !== 'off') continue;
  buildExtension(build);
  for (const b of browsers) {
    if (gate === 'access' || gate === 'confirm') {
      console.log(`\n${b} (${gate === 'access' ? 'temporary access' : 'confirmation'})`);
      try {
        if (gate === 'access') await accessScenario(b);
        else await confirmScenario(b);
      } catch (err) {
        check(b, `${gate} scenario ran`, false, err.stack ?? String(err));
      }
      continue;
    }
    if (ONLY === 'reconnect') {
      console.log(`\n${b} (reconnect)`);
      try {
        await reconnectScenario(b);
      } catch (err) {
        check(b, 'reconnect scenario ran', false, err.stack ?? String(err));
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
