#!/usr/bin/env node
/**
 * End-to-end, through the whole chain, in real browsers:
 *
 *   MCP client (this file) → `beifahrer mcp` on GJS → loopback bridge → extension → fixture page
 *
 * Usage:  node tests/e2e/browsers.e2e.mjs [chromium|firefox|shared|all]
 *
 * `shared` runs TWO MCP servers against one headless Chromium (ADR 0003): the second relays
 * through the first, and takes the browser connection over once the first is gone.
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
      '--start-url',
      url,
      '--start-url',
      `${FORBIDDEN}/fixture`,
    ],
    { stdio: LOGS ? ['ignore', 'pipe', 'pipe'] : 'ignore', detached: true },
  );
}

/** Start one `beifahrer mcp` over stdio, as an agent session would. */
async function startMcp(tokenFile, logName) {
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
  const log = logTo(logName);
  if (log) transport.stderr?.pipe(log);
  return { client, transport };
}

async function browsersOf(client) {
  const r = await tool(client, 'browsers_list');
  return r.error ? { error: r.text } : JSON.parse(r.text);
}

/** Two agent sessions, one browser: relay, then failover. */
async function sharedScenario() {
  const name = 'shared';
  const profile = mkdtempSync(join(tmpdir(), 'beifahrer-e2e-shared-'));
  const tokenFile = join(profile, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  const first = await startMcp(tokenFile, 'shared-mcp-1.log');
  let second = null;
  const proc = launch('chromium', profile);
  try {
    let status = {};
    for (let i = 0; i < 60; i++) {
      status = await browsersOf(first.client);
      if (status.browsers?.length > 0) break;
      await sleep(1000);
    }
    check(
      name,
      'first session owns the port (role hub) and sees the browser',
      status.role === 'hub' && status.browsers?.length === 1,
      JSON.stringify(status),
    );

    second = await startMcp(tokenFile, 'shared-mcp-2.log');
    const peerStatus = await browsersOf(second.client);
    check(
      name,
      'second session relays (role peer) and sees the same browser',
      peerStatus.role === 'peer' && peerStatus.browsers?.length === 1 && peerStatus.hub?.pid === status.pid,
      JSON.stringify(peerStatus),
    );
    const hubStatus = await browsersOf(first.client);
    check(name, 'the hub counts two sessions', hubStatus.sessions === 2, JSON.stringify(hubStatus));

    const tabs = await tool(second.client, 'tabs_list');
    check(
      name,
      "second session's tabs_list succeeds through the hub",
      !tabs.error && JSON.parse(tabs.text).tabs.some((t) => t.url?.startsWith(ALLOWED)),
      tabs.text.slice(0, 300),
    );

    // The first agent session ends: its MCP server exits with it.
    await first.client.close();
    let taken = {};
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      taken = await browsersOf(second.client);
      if (taken.role === 'hub' && taken.browsers?.length > 0) break;
    }
    check(
      name,
      'after the first session exits, the second takes over and the browser reconnects',
      taken.role === 'hub' && taken.browsers?.length === 1 && taken.sessions === 1,
      JSON.stringify(taken),
    );
    const after = await tool(second.client, 'tabs_list');
    check(
      name,
      'tabs_list works in the second session after the takeover',
      !after.error && JSON.parse(after.text).tabs.some((t) => t.url?.startsWith(ALLOWED)),
      after.text.slice(0, 300),
    );
  } finally {
    await first.client.close().catch(() => undefined);
    await second?.client.close().catch(() => undefined);
    try {
      process.kill(proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
  }
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
  const browserTools = tools.map((t) => t.name).filter((n) => n !== 'browsers_list');
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
const browsers = which === 'all' ? ['chromium', 'firefox', 'shared'] : [which];

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

const seed = {
  token: TOKEN,
  port: BRIDGE_PORT,
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
    if (b === 'shared' && gate !== 'on') continue;
    const label = gate === 'paused' ? 'paused' : `features ${gate}`;
    console.log(`\n${b}${b === 'shared' ? '' : ` (${label})`}`);
    try {
      await (b === 'shared' ? sharedScenario() : scenario(b, gate));
    } catch (err) {
      check(b, `scenario ran (${label})`, false, err.stack ?? String(err));
    }
  }
}

fixture.close();
fixture6.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
