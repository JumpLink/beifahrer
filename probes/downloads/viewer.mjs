/**
 * The probe behind #197: when the browser opens a saved PDF in a viewer tab, does `tabs.query` see
 * the `file://` tab, and does it appear before or after `downloads.onChanged` says `complete`?
 *
 *   node probes/downloads/viewer.mjs [chromium|firefox|all]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumBinary, firefoxBinary, localBin } from '../../extension/scripts/platform.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = Number(process.env.PROBE_PORT) || 47951;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><title>viewer probe</title><body><script>
setTimeout(() => {
  const blob = new Blob(['%PDF-1.4 probe'], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'probe viewer.pdf';
  a.click();
}, 1500);
</script>`;

async function runOne(browser) {
  const work = mkdtempSync(join(tmpdir(), `viewer-probe-${browser}-`));
  const ext = join(work, 'ext');
  const profile = join(work, 'profile');
  const downloads = join(work, 'saved');
  mkdirSync(ext, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  writeFileSync(join(ext, 'background.js'), readFileSync(join(HERE, 'viewer-background.js'), 'utf8').replace('__PORT__', String(PORT)));
  const common = { name: 'viewer probe', version: '1', content_scripts: [] };
  writeFileSync(
    join(ext, 'manifest.json'),
    JSON.stringify(
      browser === 'chromium'
        ? { ...common, manifest_version: 3, permissions: ['downloads', 'tabs'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }
        : { ...common, manifest_version: 2, permissions: ['downloads', 'tabs', 'http://127.0.0.1/*'], background: { scripts: ['background.js'] }, browser_specific_settings: { gecko: { id: 'viewer-probe@example.test' } } },
    ),
  );
  const rows = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try { rows.push(JSON.parse(body)); } catch {}
        res.end('ok');
      });
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${PORT}/page`;
  let proc;
  if (browser === 'chromium') {
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(
      join(profile, 'Default/Preferences'),
      JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: false },
        savefile: { default_directory: downloads },
        plugins: { always_open_pdf_externally: false },
        profile: { default_content_setting_values: { automatic_downloads: 1 } },
      }),
    );
    proc = spawn(chromiumBinary(), ['--headless=new', `--user-data-dir=${profile}`, `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, '--no-first-run', url], { stdio: 'ignore' });
  } else {
    mkdirSync(profile, { recursive: true });
    writeFileSync(
      join(profile, 'user.js'),
      [
        'user_pref("browser.download.folderList", 2);',
        `user_pref("browser.download.dir", ${JSON.stringify(downloads)});`,
        'user_pref("browser.download.useDownloadDir", true);',
        'user_pref("browser.download.always_ask_before_handling_new_types", false);',
        'user_pref("browser.download.open_pdf_attachments_inline", false);',
        'user_pref("pdfjs.disabled", false);',
      ].join('\n'),
    );
    // "Open in Firefox" for PDFs: action 3 is handleInternally.
    writeFileSync(
      join(profile, 'handlers.json'),
      JSON.stringify({
        defaultHandlersVersion: { 'en-US': 4 },
        mimeTypes: { 'application/pdf': { action: 3, ask: false, extensions: ['pdf'] } },
        schemes: {},
      }),
    );
    const webExt = localBin('web-ext', ROOT);
    proc = spawn(webExt.command, ['run', '--source-dir', ext, '--firefox', firefoxBinary(), '--profile-create-if-missing', '--firefox-profile', profile, '--no-reload', '--no-input', '--arg=-headless', '--start-url', url], { stdio: 'ignore', detached: true, shell: webExt.shell });
  }
  for (let i = 0; i < 40 && !rows.some((r) => r.event === 'afterComplete' && r.wait === 2500); i++) await sleep(500);
  await sleep(1000);
  const saved = readdirSync(downloads);
  try { process.kill(browser === 'firefox' ? -proc.pid : proc.pid, 'SIGTERM'); } catch {}
  await sleep(1500);
  server.close();
  rmSync(work, { recursive: true, force: true });
  return { rows, saved };
}

const which = process.argv[2] ?? 'all';
for (const browser of ['chromium', 'firefox']) {
  if (which !== 'all' && which !== browser) continue;
  const { rows, saved } = await runOne(browser);
  console.log(JSON.stringify({ browser, saved }));
  for (const r of rows) console.log('  ' + JSON.stringify(r));
}
process.exit(0);
