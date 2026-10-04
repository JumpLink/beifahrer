/**
 * The registry's files (ADR 0015): one `<instance>.json` per live bridge. A bridge writes and removes
 * ITS file; a reader only reads. Nothing here decides what an entry means, `@beifahrer/core` does.
 */

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseRegistryEntry, type RegistryEntry } from '@beifahrer/core';

/** An entry is a few hundred bytes; anything bigger is not one, and is not read. */
const MAX_ENTRY_BYTES = 64 * 1024;

/** `AgentSession.instance` is a UUID; this keeps whatever else out of a file name. */
const INSTANCE = /^[A-Za-z0-9-]{1,64}$/;

function fileOf(dir: string, instance: string): string {
  if (!INSTANCE.test(instance)) throw new Error(`not a usable session instance: ${instance}`);
  return join(dir, `${instance}.json`);
}

/**
 * Create the directory for writing, `0700`, and refuse one the current user does not own: the Linux
 * fallback lives in a shared `/tmp`, where somebody else could have made it first. Where there is no
 * uid (Windows) the temp directory is private already.
 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!ownedByMe(dir)) throw new Error(`${dir} belongs to another user`);
  chmodSync(dir, 0o700);
}

function ownedByMe(path: string): boolean {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  return uid === null || statSync(path).uid === uid;
}

/** Atomic: a reader sees the old entry or the new one, never half of either. */
export function writeEntry(dir: string, entry: RegistryEntry): void {
  const file = fileOf(dir, entry.instance);
  // Not `*.json` and dot-prefixed: a directory monitor's reader matches the exact name and never
  // sees the temp file as an entry.
  const temp = join(dir, `.${entry.instance}.json.tmp`);
  writeFileSync(temp, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export function removeEntry(dir: string, instance: string): void {
  rmSync(fileOf(dir, instance), { force: true });
}

export interface ReadEntry {
  /** The path it was read from: what a sweep removes, rather than a name taken from the content. */
  file: string;
  entry: RegistryEntry;
}

export interface ReadResult {
  entries: ReadEntry[];
  /** Files that were there and were not entries: too big, not JSON, or refused by the parser. */
  skipped: number;
}

/**
 * Every entry in the directory. A missing directory is an empty registry, not an error (no bridge
 * has ever run). A directory owned by someone else is not read at all.
 */
export function readEntries(dir: string): ReadResult {
  let names: string[];
  try {
    if (!ownedByMe(dir)) return { entries: [], skipped: 0 };
    names = readdirSync(dir);
  } catch {
    return { entries: [], skipped: 0 };
  }
  const entries: ReadEntry[] = [];
  let skipped = 0;
  for (const name of names.sort()) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      if (statSync(file).size > MAX_ENTRY_BYTES) throw new Error('too big');
      const parsed = parseRegistryEntry(JSON.parse(readFileSync(file, 'utf8')));
      // The name must be the entry's own, or one session could shadow another by writing a file.
      if (typeof parsed === 'string' || name !== `${parsed.instance}.json`) throw new Error('refused');
      entries.push({ file, entry: parsed });
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}
