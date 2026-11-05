/**
 * Files the agent may put into a page, from ONE directory the person chose (ADR 0027).
 *
 * The mirror of `save-dir.ts`: there the bridge writes into the person's folder, here it reads
 * from it. The agent names paths, never the person's whole disk: every path must resolve, after
 * symlinks and `..`, to a regular file inside the directory the MCP server was started with.
 * Unset means no upload at all (fail closed), and a refusal comes BEFORE the browser is asked.
 *
 * The bridge reads the bytes because the page needs them and the extension has no disk access.
 * They go to the extension and into the page; they never go back to the agent.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { MAX_UPLOAD_FILE_BYTES, mimeOfName, uploadRefusal, type UploadFile } from '@beifahrer/core';

export interface UploadArgs {
  'upload-dir'?: string;
}

/** The yargs option, the same on every command that serves MCP tools. */
export const uploadDirOptions = {
  'upload-dir': {
    type: 'string',
    describe:
      'Absolute directory files may be uploaded from when a tool call passes `paths` (also: BEIFAHRER_UPLOAD_DIR). Unset: nothing is ever uploaded.',
  },
} as const;

/** The person's directory from `--upload-dir` / `BEIFAHRER_UPLOAD_DIR`; undefined when none is set. */
export function uploadRootOf(argv: UploadArgs, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (argv['upload-dir'] ?? env.BEIFAHRER_UPLOAD_DIR ?? '').trim();
  if (!raw) return undefined;
  if (!isAbsolute(raw) || raw.includes('\0'))
    throw new Error(`--upload-dir / BEIFAHRER_UPLOAD_DIR must be an absolute path, got "${raw}"`);
  return resolve(raw);
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * `path` canonicalized up to, but not including, its final component: the leaf is left as given,
 * so a symlink AT the leaf is still caught by the caller's own realpath check with its own
 * message, while an ancestor directory that is itself a symlink — including macOS's `/var` →
 * `/private/var`, which is exactly as real as one the person made — compares equal either way it
 * was spelled.
 */
function realBeforeLeaf(path: string): string {
  const extra: string[] = [];
  let at = dirname(path);
  while (!existsSync(at)) {
    extra.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...extra, basename(path));
}

/**
 * Reads the named files for one call. A relative path counts from the person's directory. Throws a
 * plain Error the agent can relay, naming the path the agent gave and never one it was not given.
 */
export function readUploads(root: string | undefined, paths: readonly string[]): UploadFile[] {
  if (!root)
    throw new Error(
      'page_upload refused: the person has not allowed uploads. They start the MCP server with --upload-dir <dir> or BEIFAHRER_UPLOAD_DIR',
    );
  if (paths.length === 0) throw new Error('page_upload refused: no paths given');
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new Error(`page_upload refused: the upload directory ${root} does not exist`);
  }
  const files: { name: string; real: string; size: number }[] = [];
  for (const requested of paths) {
    const refuse = (why: string) =>
      new Error(`path "${requested}" refused: ${why} (the person allowed only ${root})`);
    if (typeof requested !== 'string' || requested === '' || requested.includes('\0'))
      throw refuse('it is not a usable path');
    const wanted = resolve(realRoot, requested);
    if (!inside(realRoot, realBeforeLeaf(wanted))) throw refuse('it is outside the allowed directory');
    let real: string;
    try {
      real = realpathSync(wanted);
    } catch {
      throw refuse('no such file');
    }
    if (!inside(realRoot, real)) throw refuse('a symlink leads out of the allowed directory');
    const stat = statSync(real);
    if (!stat.isFile()) throw refuse('it is not a regular file');
    if (stat.size > MAX_UPLOAD_FILE_BYTES) throw refuse('the file is too large');
    files.push({ name: basename(real), real, size: stat.size });
  }
  const refusal = uploadRefusal(files);
  if (refusal) throw new Error(`page_upload refused: ${refusal}`);
  return files.map(({ name, real }) => {
    const bytes = readFileSync(real);
    // The size that counts is the one read, not the one stat saw a moment ago.
    if (bytes.length > MAX_UPLOAD_FILE_BYTES)
      throw new Error(`path "${name}" refused: the file is too large`);
    return { name, mime: mimeOfName(name), size: bytes.length, base64: bytes.toString('base64') };
  });
}
