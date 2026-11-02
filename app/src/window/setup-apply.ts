/**
 * The one place the window writes an agent's config (ADR 0023 § 2). The disk is behind `FileOps`, so
 * the order of things is testable without one, and the order is the safety net:
 *
 *  1. no confirmation, no read and no write;
 *  2. the file must still be what the person was shown, or they look again;
 *  3. the plan is made again from that text, and `unchanged` or `unparseable` end here;
 *  4. the old file is copied to its backup and read back BEFORE the original is touched;
 *  5. the new text replaces the old in one step, and is read back.
 */

import { backupPathOf, planConfigEdit, type AgentEntry, type ServerSpec } from '@beifahrer/core';

export interface FileOps {
  /** The file's text, or null when there is no such file. Any other failure throws. */
  read(path: string): string | null;
  /** Creates the file and fails when it exists, so a backup never overwrites an older one. */
  createNew(path: string, text: string): void;
  /** Replaces the file (or creates it, with its folder) so a reader sees the old or the new text, never half. */
  replace(path: string, text: string): void;
}

export interface ApplyRequest {
  agent: AgentEntry;
  file: string;
  server: ServerSpec;
  /** The file's text when the diff was made; null when there was no file. */
  shown: string | null;
  /** True only from the person's click on the button that names the change. */
  confirmed: boolean;
  now: Date;
}

export type ApplyResult =
  | { status: 'written'; backup: string | null }
  | { status: 'unchanged' }
  | { status: 'not-confirmed' }
  | { status: 'changed-meanwhile' }
  | { status: 'unparseable' }
  | { status: 'backup-failed'; reason: string }
  | { status: 'write-failed'; backup: string | null; reason: string };

export function applyConfigEdit(req: ApplyRequest, ops: FileOps): ApplyResult {
  if (!req.confirmed) return { status: 'not-confirmed' };
  let current: string | null;
  try {
    current = ops.read(req.file);
  } catch (err) {
    return { status: 'backup-failed', reason: reasonOf(err) };
  }
  if (current !== req.shown) return { status: 'changed-meanwhile' };
  const plan = planConfigEdit(req.agent, current, req.server);
  if (plan.kind === 'unchanged') return { status: 'unchanged' };
  if (plan.kind === 'unparseable') return { status: 'unparseable' };

  let backup: string | null = null;
  if (current !== null) {
    backup = backupPathOf(req.file, req.now);
    try {
      ops.createNew(backup, current);
      if (ops.read(backup) !== current) return { status: 'backup-failed', reason: 'backup differs' };
    } catch (err) {
      return { status: 'backup-failed', reason: reasonOf(err) };
    }
  }
  try {
    ops.replace(req.file, plan.after);
    if (ops.read(req.file) !== plan.after)
      return { status: 'write-failed', backup, reason: 'read-back differs' };
  } catch (err) {
    return { status: 'write-failed', backup, reason: reasonOf(err) };
  }
  return { status: 'written', backup };
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
