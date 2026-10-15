/**
 * Captured files on disk instead of in the agent's context (ADR 0021).
 *
 * `page.capture` answers with the whole file as base64. An agent that only wants to hand it to
 * another tool (a Paperless upload taking a `file_path`) would burn its context on bytes it never
 * reads. With a save directory configured by the PERSON, the caller may ask for the file to be
 * written there and gets `{path, filename, mime, size, sha256, via}` back.
 *
 * The bridge writes, never the extension (an extension has no business on the disk), and the
 * directory is the person's choice, never the agent's: the caller's `saveDir` must lie inside the
 * directory the MCP server was started with. Unset means no saving at all (fail closed), and a
 * path that escapes the root, by `..` or by a symlink, is refused BEFORE anything is clicked.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Result } from '@beifahrer/core';

export interface SaveArgs {
  'save-dir'?: string;
}

/** The yargs option, the same on every command that serves MCP tools. */
export const saveDirOptions = {
  'save-dir': {
    type: 'string',
    describe:
      'Absolute directory captured files may be written to when a tool call passes `saveDir` (also: BEIFAHRER_SAVE_DIR). Unset: nothing is ever written.',
  },
} as const;

/** What the MCP tools need to know about saving, handed down from the command line. */
export interface SaveOptions {
  /** The person's directory (`saveRootOf`); absent means no tool may write a file. */
  saveRoot?: string;
}

export interface SavedFile {
  path: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  via: string;
}

/** Writes one captured file; throws a plain Error the agent can relay. */
export type SaveCapture = (doc: Result<'page.capture'>) => SavedFile;

const MAX_NAME = 120;

/** The person's directory from `--save-dir` / `BEIFAHRER_SAVE_DIR`; undefined when none is set. */
export function saveRootOf(argv: SaveArgs, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (argv['save-dir'] ?? env.BEIFAHRER_SAVE_DIR ?? '').trim();
  if (!raw) return undefined;
  if (!isAbsolute(raw) || raw.includes('\0'))
    throw new Error(`--save-dir / BEIFAHRER_SAVE_DIR must be an absolute path, got "${raw}"`);
  return resolve(raw);
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The nearest ancestor of `path` that exists, resolved through symlinks. */
function realAncestor(path: string): string {
  let at = path;
  while (!existsSync(at)) at = dirname(at);
  return realpathSync(at);
}

/**
 * The directory a file may go to, created (0700) when missing. Checked twice: lexically, and again
 * through symlinks BEFORE anything is created, so a link inside the root cannot lead a `mkdir`
 * outside it.
 */
export function targetDir(root: string, requested: string): string {
  const refuse = (why: string) =>
    new Error(`saveDir "${requested}" refused: ${why} (the person allowed only ${root})`);
  if (!isAbsolute(requested) || requested.includes('\0')) throw refuse('it must be an absolute path');
  const wanted = resolve(requested);
  if (!inside(root, wanted)) throw refuse('it is outside the allowed directory');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(root);
  if (!inside(realRoot, realAncestor(wanted))) throw refuse('a symlink leads out of the allowed directory');
  mkdirSync(wanted, { recursive: true, mode: 0o700 });
  const real = realpathSync(wanted);
  if (!inside(realRoot, real)) throw refuse('a symlink leads out of the allowed directory');
  return real;
}

/** A name that is only a name: no path, no control characters, not hidden, not empty. */
export function safeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!cleaned) return 'download';
  if (cleaned.length <= MAX_NAME) return cleaned;
  const ext = extname(cleaned).slice(0, 16);
  return cleaned.slice(0, MAX_NAME - ext.length) + ext;
}

/**
 * The writer for one call, or undefined when the caller did not ask for a file. Throws when it
 * asked and may not — the person set no directory, or it points elsewhere — so a refusal comes
 * before the click that would have marked a document as read.
 */
export function captureSink(
  root: string | undefined,
  requested: string | undefined,
): SaveCapture | undefined {
  if (requested === undefined) return undefined;
  if (!root)
    throw new Error(
      'saveDir refused: the person has not allowed saving files. They start the MCP server with --save-dir <dir> or BEIFAHRER_SAVE_DIR; until then the file can only come back as base64 (omit saveDir)',
    );
  const dir = targetDir(root, requested);
  return (doc) => {
    // The browser wrote this one itself: there are no bytes here to write, only its outcome.
    if (doc.via === 'download') return doc as unknown as SavedFile;
    const bytes = Buffer.from(doc.base64, 'base64');
    const wanted = safeFilename(doc.filename);
    const ext = extname(wanted);
    const stem = basename(wanted, ext);
    for (let n = 0; n < 1000; n++) {
      const filename = n === 0 ? wanted : `${stem} (${n})${ext}`;
      const path = join(dir, filename);
      try {
        // `wx` makes the name unique atomically; `mode` keeps the file to its owner.
        writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw err;
      }
      return {
        path,
        filename,
        mime: doc.mime,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        via: doc.via,
      };
    }
    throw new Error(`no free name for "${wanted}" in ${dir}`);
  };
}
