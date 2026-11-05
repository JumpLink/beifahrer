import { applyReadOnlyGate } from '@gjsify/mcp';
import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_UPLOAD_FILE_BYTES, mimeOfName, uploadRefusal } from '@beifahrer/core';
import { registerTools } from '../../../src/frontends/mcp/tools.ts';
import { readUploads, uploadRootOf } from '../../../src/upload-dir.ts';
import { createRecorder } from './recorder.ts';

function scratch() {
  const base = mkdtempSync(join(tmpdir(), 'beifahrer-upload-'));
  const root = join(base, 'out');
  mkdirSync(root);
  return { base, root, done: () => rmSync(base, { recursive: true, force: true }) };
}

export default async () => {
  await describe('uploading local files', async () => {
    await it('is off unless the person set a directory', async () => {
      expect(uploadRootOf({}, {})).toBe(undefined);
      expect(uploadRootOf({ 'upload-dir': '/srv/up/' }, {})).toBe('/srv/up');
      expect(uploadRootOf({}, { BEIFAHRER_UPLOAD_DIR: '/srv/up' })).toBe('/srv/up');
      expect(() => uploadRootOf({ 'upload-dir': 'rel' }, {})).toThrow(/absolute/);
      expect(() => readUploads(undefined, ['a.pdf'])).toThrow(/not allowed uploads/);
    });

    await it('reads a file inside the root, relative or absolute, with name, mime and size', async () => {
      const s = scratch();
      writeFileSync(join(s.root, 'invoice.pdf'), 'hello');
      const [rel] = readUploads(s.root, ['invoice.pdf']);
      expect(rel!.name).toBe('invoice.pdf');
      expect(rel!.mime).toBe('application/pdf');
      expect(rel!.size).toBe(5);
      expect(Buffer.from(rel!.base64, 'base64').toString()).toBe('hello');
      expect(readUploads(s.root, [join(s.root, 'invoice.pdf')]).length).toBe(1);
      s.done();
    });

    await it('refuses .., a sibling prefix, a symlink out, a directory and a missing file', async () => {
      const s = scratch();
      writeFileSync(join(s.base, 'secret.txt'), 'x');
      mkdirSync(join(s.base, 'out-evil'));
      writeFileSync(join(s.base, 'out-evil', 'a.txt'), 'x');
      symlinkSync(join(s.base, 'secret.txt'), join(s.root, 'link.txt'));
      mkdirSync(join(s.root, 'dir'));
      expect(() => readUploads(s.root, ['../secret.txt'])).toThrow(/outside/);
      expect(() => readUploads(s.root, [join(s.base, 'out-evil', 'a.txt')])).toThrow(/outside/);
      expect(() => readUploads(s.root, ['link.txt'])).toThrow(/symlink/);
      expect(() => readUploads(s.root, ['dir'])).toThrow(/regular file/);
      expect(() => readUploads(s.root, ['nope.txt'])).toThrow(/no such file/);
      expect(() => readUploads(s.root, [])).toThrow(/no paths/);
      s.done();
    });

    await it('enforces the size caps', async () => {
      const s = scratch();
      writeFileSync(join(s.root, 'big.bin'), Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1));
      expect(() => readUploads(s.root, ['big.bin'])).toThrow(/too large/);
      expect(uploadRefusal([])).toBe('no files given');
      expect(uploadRefusal([{ size: 1 }])).toBe(null);
      expect(uploadRefusal(Array.from({ length: 11 }, () => ({ size: 1 })))).toMatch(/at most/);
      expect(uploadRefusal([{ size: 9e6 }, { size: 9e6 }, { size: 9e6 }])).toMatch(/together/);
      s.done();
    });

    await it('guesses a type from the name', async () => {
      expect(mimeOfName('a.PNG')).toBe('image/png');
      expect(mimeOfName('a.unknown')).toBe('application/octet-stream');
      expect(mimeOfName('constructor')).toBe('application/octet-stream');
    });

    await it('page_upload takes paths, is refused without a root and never echoes bytes', async () => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, true);
      registerTools(rec.server, { bridge: null });
      const tool = rec.find('page_upload')!;
      expect(Object.keys(tool.inputSchema ?? {})).toContain('paths');
      const res = (await rec.invoke('page_upload', { tabId: 1, ref: 'e1', paths: ['a.pdf'] })) as {
        isError?: boolean;
        content: { type: string; text?: string }[];
      };
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text ?? '').toMatch(/not allowed uploads/);
    });
  });
};
