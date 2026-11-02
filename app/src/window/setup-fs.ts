/**
 * `FileOps` on the real disk. The replace goes through a temporary file in the same folder and a
 * rename, so an agent that reads its config while the window writes it sees the old or the new file;
 * the file keeps its permission bits, because `~/.claude.json` and friends hold tokens and are 0600.
 */

import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { FileOps } from './setup-apply.ts';

export const diskOps: FileOps = {
  read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  createNew(path, text) {
    // 'wx': fails when the file exists. The backup of a second run gets its own name from the clock.
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(fd, text, 'utf8');
    } finally {
      closeSync(fd);
    }
  },
  replace(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    let mode: number | undefined;
    try {
      mode = statSync(path).mode & 0o777;
    } catch {
      mode = undefined;
    }
    const tmp = `${path}.beifahrer-tmp-${process.pid}`;
    try {
      writeFileSync(tmp, text, { encoding: 'utf8', mode: mode ?? 0o600 });
      if (mode !== undefined) chmodSync(tmp, mode);
      renameSync(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  },
};
