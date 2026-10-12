/**
 * The probe behind ADR 0019. For each browser and each way a page can save a blob, it loads a
 * throw-away extension (permission `downloads`, nothing else of Beifahrer) in a throw-away profile,
 * lets a synthetic page on 127.0.0.1 save a blob, and prints what `downloads.onCreated` delivered,
 * whether the page-side fetch could still read it, and whether a file landed in the download folder.
 *
 *   node probes/downloads/run.mjs [chromium|firefox|all]
 *
 * Needs Playwright's Chromium and a Firefox, resolved like the e2e (extension/scripts/platform.ts).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumBinary, firefoxBinary, localBin } from '../../extension/scripts/platform.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = Number(process.env.PROBE_PORT) || 47950;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How a page can save a blob. `keep`: the blob lives on. `revoke-sync`: revoked on the line after
// click(). `revoke-tick`: revoked in a timeout of 0, which is what FileSaver-style code does.
const VARIANTS = ['keep', 'revoke-sync', 'revoke-tick'];

const pageFor = (v) => `<!doctype html><title>probe ${v}</title><body><script>
setTimeout(() => {
  const blob = new Blob(['%PDF-1.4 probe ' + 'x'.repeat(4000)], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'probe-${v}.pdf';
  a.click();
  if ('${v}' === 'revoke-sync') URL.revokeObjectURL(a.href);
  if ('${v}' === 'revoke-tick') setTimeout(() => URL.revokeObjectURL(a.href), 0);
}, 1500);
</script>`;

function extensionDir(browser, dest) {
  mkdirSync(dest, { recursive: true });
  const bg = readFileSync(join(HERE, 'background.js'), 'utf8').replace('__PORT__', String(PORT));
  writeFileSync(join(dest, 'background.js'), bg);
  cpSync(join(HERE, 'content.js'), join(dest, 'content.js'));
  const content_scripts = [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' }];
  const common = { name: 'downloads probe', version: '1', content_scripts };
  const manifest =
    browser === 'chromium'
      ? {
          ...common,
          manifest_version: 3,
          permissions: ['downloads', 'tabs'],
          host_permissions: ['http://127.0.0.1/*'],
          background: { service_worker: 'background.js' },
        }
      : {
          ...common,
          manifest_version: 2,
          permissions: ['downloads', 'tabs', 'http://127.0.0.1/*'],
          background: { scripts: ['background.js'] },
          browser_specific_settings: { gecko: { id: 'downloads-probe@example.test' } },
        };
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest));
}

async function runOne(browser, variant) {
  const work = mkdtempSync(join(tmpdir(), `downloads-probe-${browser}-`));
  const ext = join(work, 'ext');
  const profile = join(work, 'profile');
  const downloads = join(work, 'saved');
  mkdirSync(downloads, { recursive: true });
  extensionDir(browser, ext);

  const rows = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          rows.push(JSON.parse(body));
        } catch {}
        res.end('ok');
      });
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(pageFor(variant));
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
        'user_pref("browser.download.useDownloadDir", true);',
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
  for (let i = 0; i < 40 && !rows.some((r) => r.event === 'onCreated'); i++) await sleep(500);
  await sleep(3000);
  const saved = existsSync(downloads) ? readdirSync(downloads) : [];
  try {
    process.kill(browser === 'firefox' ? -proc.pid : proc.pid, 'SIGTERM');
  } catch {}
  await sleep(1500);
  server.close();
  rmSync(work, { recursive: true, force: true });
  return { rows, saved };
}

const which = process.argv[2] ?? 'all';
for (const browser of ['chromium', 'firefox']) {
  if (which !== 'all' && which !== browser) continue;
  for (const v of VARIANTS) {
    const { rows, saved } = await runOne(browser, v);
    const c = rows.find((r) => r.event === 'onCreated');
    console.log(
      JSON.stringify({
        browser,
        variant: v,
        delivered: !!c,
        urlScheme: c ? c.url.split(':')[0] : null,
        read: c?.read ?? null,
        readMs: c?.readMs ?? null,
        cancel: c?.cancel ?? null,
        removeFile: c?.removeFile ?? null,
        erase: c?.erase ?? null,
        stateAfter: c?.stateAfter ?? null,
        changes: rows.filter((r) => r.event === 'onChanged').map((r) => r.state ?? r.error),
        savedFiles: saved,
      }),
    );
  }
}
process.exit(0);
