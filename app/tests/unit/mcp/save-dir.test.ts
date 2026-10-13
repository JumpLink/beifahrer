import { applyReadOnlyGate } from '@gjsify/mcp';
import { describe, expect, it } from '@gjsify/unit';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerTools } from '../../../src/frontends/mcp/tools.ts';
import { captureSink, safeFilename, saveRootOf } from '../../../src/save-dir.ts';
import { createRecorder } from './recorder.ts';

const doc = (filename: string, text = 'hello') => ({
  url: 'https://bank.example/x',
  filename,
  mime: 'application/pdf',
  size: text.length,
  base64: Buffer.from(text).toString('base64'),
  via: 'link' as const,
});

const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'beifahrer-save-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

export default async () => {
  await describe('saving captured files', async () => {
    await it('is off unless the person set a directory', async () => {
      expect(saveRootOf({}, {})).toBe(undefined);
      expect(saveRootOf({}, { BEIFAHRER_SAVE_DIR: '  ' })).toBe(undefined);
      expect(saveRootOf({ 'save-dir': '/srv/inbox/' }, {})).toBe('/srv/inbox');
      expect(saveRootOf({}, { BEIFAHRER_SAVE_DIR: '/srv/inbox' })).toBe('/srv/inbox');
      expect(() => saveRootOf({ 'save-dir': 'relative/dir' }, {})).toThrow(/absolute/);
    });

    await it('refuses a saveDir when none is configured, and does nothing when none is asked', async () => {
      expect(() => captureSink(undefined, '/tmp/x')).toThrow(/not allowed saving files/);
      expect(captureSink(undefined, undefined)).toBe(undefined);
      const s = scratch();
      expect(captureSink(s.root, undefined)).toBe(undefined);
      s.done();
    });

    await it('writes the file with mode 0600 and answers without base64', async () => {
      const s = scratch();
      const save = captureSink(s.root, s.root)!;
      const saved = save(doc('Kontoauszug 09.pdf'));
      expect(saved.path).toBe(join(readlinkRoot(s.root), 'Kontoauszug 09.pdf'));
      expect(saved.filename).toBe('Kontoauszug 09.pdf');
      expect(saved.mime).toBe('application/pdf');
      expect(saved.size).toBe(5);
      expect(saved.sha256).toBe(HELLO_SHA);
      expect(saved.via).toBe('link');
      expect('base64' in saved).toBe(false);
      expect(readFileSync(saved.path, 'utf8')).toBe('hello');
      expect(statSync(saved.path).mode & 0o777).toBe(0o600);
      s.done();
    });

    await it('creates a subdirectory below the root and never overwrites', async () => {
      const s = scratch();
      const sub = join(s.root, 'bank', '2026');
      const first = captureSink(s.root, sub)!(doc('a.pdf', 'one'));
      const second = captureSink(s.root, sub)!(doc('a.pdf', 'two'));
      expect(first.filename).toBe('a.pdf');
      expect(second.filename).toBe('a (1).pdf');
      expect(readFileSync(first.path, 'utf8')).toBe('one');
      expect(readFileSync(second.path, 'utf8')).toBe('two');
      expect(statSync(sub).mode & 0o777).toBe(0o700);
      s.done();
    });

    await it('refuses a directory outside the root, by path or by traversal', async () => {
      const s = scratch();
      const other = mkdtempSync(join(tmpdir(), 'beifahrer-other-'));
      expect(() => captureSink(s.root, other)).toThrow(/outside the allowed directory/);
      expect(() => captureSink(s.root, join(s.root, '..', 'elsewhere'))).toThrow(/outside/);
      expect(() => captureSink(s.root, `${s.root}-sibling`)).toThrow(/outside/);
      expect(() => captureSink(s.root, 'relative')).toThrow(/absolute/);
      expect(existsSync(join(s.root, '..', 'elsewhere'))).toBe(false);
      rmSync(other, { recursive: true, force: true });
      s.done();
    });

    await it('refuses a symlink inside the root that leads out, before creating anything', async () => {
      const s = scratch();
      const other = mkdtempSync(join(tmpdir(), 'beifahrer-other-'));
      symlinkSync(other, join(s.root, 'escape'));
      expect(() => captureSink(s.root, join(s.root, 'escape'))).toThrow(/symlink/);
      expect(() => captureSink(s.root, join(s.root, 'escape', 'new'))).toThrow(/symlink/);
      expect(readdirSync(other).length).toBe(0);
      rmSync(other, { recursive: true, force: true });
      s.done();
    });

    await it('turns a hostile filename into a plain name inside the directory', async () => {
      expect(safeFilename('../../etc/passwd')).toBe('passwd');
      expect(safeFilename('..\\..\\evil.exe')).toBe('evil.exe');
      expect(safeFilename('.bashrc')).toBe('bashrc');
      expect(safeFilename('..')).toBe('download');
      expect(safeFilename('')).toBe('download');
      expect(safeFilename('a\u0000b\nc.pdf')).toBe('abc.pdf');
      expect(safeFilename('a:b*c.pdf')).toBe('a_b_c.pdf');
      const long = safeFilename(`${'x'.repeat(300)}.pdf`);
      expect(long.length).toBe(120);
      expect(long.endsWith('.pdf')).toBe(true);
      const s = scratch();
      const saved = captureSink(s.root, s.root)!(doc('../../escape.pdf'));
      expect(saved.path.startsWith(readlinkRoot(s.root))).toBe(true);
      expect(saved.filename).toBe('escape.pdf');
      s.done();
    });
  });

  await describe('saveDir on the tools', async () => {
    const mcp = (saveRoot?: string) => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, true);
      registerTools(rec.server, { bridge: null }, {}, { saveRoot });
      return rec;
    };

    await it('is offered by page_capture and recipe_run, and by no read tool', async () => {
      const rec = mcp();
      for (const t of rec.tools) {
        const has = t.inputSchema !== undefined && 'saveDir' in t.inputSchema;
        expect(has).toBe(t.name === 'page_capture' || t.name === 'recipe_run');
      }
    });

    await it('refuses before any browser call when saving is not allowed', async () => {
      const rec = mcp();
      const res = await rec.invoke('page_capture', { tabId: 1, ref: 'e1', saveDir: '/tmp/x' });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/not allowed saving files/);
      const run = await rec.invoke('recipe_run', { tabId: 1, id: 'x/y', saveDir: '/tmp/x' });
      expect(run.isError).toBe(true);
    });

    await it('says in the description that the file can come back as a path', async () => {
      const rec = mcp();
      expect(rec.find('page_capture')?.description ?? '').toMatch(/saveDir/);
      expect(rec.find('recipe_run')?.description ?? '').toMatch(/saveDir/);
    });
  });
};

/** `mkdtemp` under a symlinked tmp (macOS) answers with the real path; compare like with like. */
const readlinkRoot = (root: string) => realpathSync(root);
