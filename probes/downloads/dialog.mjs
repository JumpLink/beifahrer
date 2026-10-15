/**
 * The probe behind issue #127: does the browser's "ask where to save" dialog stall a download, and does
 * the way the download starts change that?
 *
 *   node probes/downloads/dialog.mjs [chromium|firefox|all]
 *
 * For each browser, with the profile set to "ask" or "do not ask", a synthetic page on 127.0.0.1
 * triggers an attachment either by navigating to it (`native`, what a portal's button does) or the
 * extension calls `downloads.download({ saveAs: false })` (`api`). After a fixed wait the extension
 * reports every `onCreated`/`onChanged` it heard and what `downloads.search` says, and the driver
 * lists the files in the download folder. One JSON line per run.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumBinary, firefoxBinary, localBin } from '../../extension/scripts/platform.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = Number(process.env.PROBE_PORT) || 47951;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_MS = Number(process.env.PROBE_WAIT_MS) || 9000;

const background = (method) => `
const api = typeof browser !== 'undefined' ? browser : chrome;
const REPORT = 'http://127.0.0.1:${PORT}/report';
const t0 = Date.now();
const log = [];
const note = (row) => log.push({ at: Date.now() - t0, ...row });
api.downloads.onCreated.addListener((i) => note({ ev: 'created', id: i.id, state: i.state, filename: i.filename || '', url: i.url }));
api.downloads.onChanged.addListener((d) => note({ ev: 'changed', id: d.id, state: d.state?.current, error: d.error?.current, filename: d.filename?.current, paused: d.paused?.current }));
${method === 'api' ? `setTimeout(async () => {
  try { const id = await api.downloads.download({ url: 'http://127.0.0.1:${PORT}/file.bin', saveAs: false }); note({ ev: 'download() resolved', id }); }
  catch (e) { note({ ev: 'download() rejected', error: String(e) }); }
}, 1500);` : ''}
setTimeout(async () => {
  const items = await api.downloads.search({});
  note({ ev: 'search', items: items.map((i) => ({ id: i.id, state: i.state, filename: i.filename || '', bytesReceived: i.bytesReceived, totalBytes: i.totalBytes, error: i.error, paused: i.paused })) });
  fetch(REPORT, { method: 'POST', body: JSON.stringify(log) }).catch(() => undefined);
}, ${WAIT_MS - 1500});
`;

function extensionDir(browser, dest, method) {
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'background.js'), background(method));
  const common = { name: 'dialog probe', version: '1' };
  const manifest =
    browser === 'chromium'
      ? { ...common, manifest_version: 3, permissions: ['downloads'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }
      : {
          ...common,
          manifest_version: 2,
          permissions: ['downloads', 'http://127.0.0.1/*'],
          background: { scripts: ['background.js'] },
          browser_specific_settings: { gecko: { id: 'dialog-probe@example.test' } },
        };
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest));
}

async function runOne(browser, ask, method) {
  const work = mkdtempSync(join(tmpdir(), `dialog-probe-${browser}-`));
  const ext = join(work, 'ext');
  const profile = join(work, 'profile');
  const downloads = join(work, 'saved');
  mkdirSync(downloads, { recursive: true });
  extensionDir(browser, ext, method);

  let report = null;
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          report = JSON.parse(body);
        } catch {}
        res.end('ok');
      });
      return;
    }
    if (req.url.startsWith('/file.bin')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.bin"' });
      res.end(Buffer.alloc(3000, 7));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      method === 'native'
        ? '<!doctype html><title>probe</title><script>setTimeout(() => { location.href = "/file.bin"; }, 1500);</script>'
        : '<!doctype html><title>probe</title>idle',
    );
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${PORT}/page`;

  let proc;
  if (browser === 'chromium') {
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(
      join(profile, 'Default/Preferences'),
      JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: ask },
        savefile: { default_directory: downloads },
        profile: { default_content_setting_values: { automatic_downloads: 1 } },
      }),
    );
    proc = spawn(
      chromiumBinary(),
      ['--headless=new', `--user-data-dir=${profile}`, `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, '--no-first-run', url],
      { stdio: 'ignore' },
    );
  } else {
    mkdirSync(profile, { recursive: true });
    writeFileSync(
      join(profile, 'user.js'),
      [
        'user_pref("browser.download.folderList", 2);',
        `user_pref("browser.download.dir", ${JSON.stringify(downloads)});`,
        `user_pref("browser.download.useDownloadDir", ${ask ? 'false' : 'true'});`,
        'user_pref("browser.download.always_ask_before_handling_new_types", false);',
        'user_pref("browser.download.open_pdf_attachments_inline", false);',
        'user_pref("pdfjs.disabled", true);',
      ].join('\n'),
    );
    const webExt = localBin('web-ext', ROOT);
    proc = spawn(
      webExt.command,
      ['run', '--source-dir', ext, '--firefox', firefoxBinary(), '--profile-create-if-missing', '--firefox-profile', profile, '--no-reload', '--no-input', '--arg=-headless', '--start-url', url],
      { stdio: 'ignore', detached: true, shell: webExt.shell },
    );
  }
  for (let i = 0; i < 80 && !report; i++) await sleep(500);
  const saved = existsSync(downloads) ? readdirSync(downloads) : [];
  try {
    process.kill(browser === 'firefox' ? -proc.pid : proc.pid, 'SIGTERM');
  } catch {}
  await sleep(1500);
  server.close();
  rmSync(work, { recursive: true, force: true });
  return { report, saved };
}

const which = process.argv[2] ?? 'all';
for (const browser of ['chromium', 'firefox']) {
  if (which !== 'all' && which !== browser) continue;
  for (const ask of [false, true]) {
    for (const method of ['native', 'api']) {
      const { report, saved } = await runOne(browser, ask, method);
      console.log(JSON.stringify({ browser, ask, method, savedFiles: saved, report }));
    }
  }
}
process.exit(0);
