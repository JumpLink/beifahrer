#!/usr/bin/env node
/**
 * End-to-end, through the whole chain, in real browsers:
 *
 *   MCP client (this file) → `beifahrer mcp` on GJS → loopback bridge → extension → fixture page
 *
 * Usage:  node tests/e2e/browsers.e2e.mjs [chromium|firefox|all]
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
import { createWriteStream, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_PORT = 47901;
const BRIDGE_PORT = 47902;
const DEVTOOLS_PORT = 47903;
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
</script></body></html>`;

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
  const env = { ...process.env, BEIFAHRER_E2E_SEED: JSON.stringify(seed) };
  const wxt = join(ROOT, 'node_modules/.bin/wxt');
  execFileSync(wxt, ['build'], { cwd: join(ROOT, 'extension'), env, stdio: 'ignore' });
  execFileSync(wxt, ['build', '-b', 'firefox'], { cwd: join(ROOT, 'extension'), env, stdio: 'ignore' });
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
      '--start-url',
      url,
      '--start-url',
      `${FORBIDDEN}/fixture`,
    ],
    { stdio: LOGS ? ['ignore', 'pipe', 'pipe'] : 'ignore', detached: true },
  );
}

async function scenario(browser) {
  const profile = mkdtempSync(join(tmpdir(), `beifahrer-e2e-${browser}-`));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  const transport = new StdioClientTransport({
    command: join(ROOT, 'node_modules/.bin/gjsify'),
    args: [
      'run',
      join(ROOT, 'app/dist/beifahrer.gjs.mjs'),
      'mcp',
      '--port',
      String(BRIDGE_PORT),
      '--allow-write',
    ],
    env: { ...process.env, BEIFAHRER_TOKEN_FILE: tokenFile },
    stderr: LOGS ? 'pipe' : 'ignore',
  });
  const client = new Client({ name: 'beifahrer-e2e', version: '0' });
  await client.connect(transport);
  const mcpLog = logTo(`${browser}-mcp.log`);
  if (mcpLog) transport.stderr?.pipe(mcpLog);

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

const fixture = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE);
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, '127.0.0.1', r));
// `localhost` must reach the same server for the forbidden-origin cases.
const fixture6 = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE);
});
await new Promise((r) => fixture6.listen(FIXTURE_PORT, '::1', r)).catch(() => undefined);

buildExtension({
  token: TOKEN,
  port: BRIDGE_PORT,
  policy: { origins: { [ALLOWED]: { level: 'write', confirmWrites: false } } },
});

for (const b of browsers) {
  console.log(`\n${b}`);
  try {
    await scenario(b);
  } catch (err) {
    check(b, 'scenario ran', false, err.stack ?? String(err));
  }
}

fixture.close();
fixture6.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
