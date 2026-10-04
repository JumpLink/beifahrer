/**
 * Keeps one bridge's registry entry current (ADR 0015 §3): written at once, rewritten when a browser
 * comes or goes or the session is renamed, and re-stamped every `HEARTBEAT_MS` so a reader can tell a
 * live bridge from a crashed one. Removed on a clean stop and at process exit.
 *
 * The registry only OBSERVES. A write that fails (a full disk, a runtime directory that vanished) is
 * reported once and the bridge goes on: an agent session must never end because a status file could
 * not be written.
 */

import { rmSync } from 'node:fs';
import { HEARTBEAT_MS, entryOf, sweepable, type BridgeStatus } from '@beifahrer/core';

import { registryDir } from './registry-dir.ts';
import { ensureDir, readEntries, removeEntry, writeEntry } from './store.ts';

/** What the publisher needs of a bridge: `Bridge` satisfies it, a test passes a small fake. */
export interface Publishable {
  status(): BridgeStatus;
  on(event: 'connected' | 'disconnected' | 'session', listener: () => void): unknown;
  off(event: 'connected' | 'disconnected' | 'session', listener: () => void): unknown;
}

export interface PublishOptions {
  dir?: string;
  heartbeatMs?: number;
  now?: () => Date;
  /** Told once, with the first failure. */
  onError?: (err: Error) => void;
}

export interface Publisher {
  /** Remove the entry and stop the heartbeat. Safe to call twice. */
  stop(): void;
}

export function publishRegistry(bridge: Publishable, options: PublishOptions = {}): Publisher {
  const dir = options.dir ?? registryDir();
  const now = options.now ?? (() => new Date());
  const instance = bridge.status().session.instance;
  let reported = false;
  let stopped = false;

  const attempt = (what: () => void) => {
    try {
      what();
    } catch (err) {
      if (reported) return;
      reported = true;
      options.onError?.(err as Error);
    }
  };

  const write = () => {
    if (!stopped) attempt(() => writeEntry(dir, entryOf(bridge.status(), now())));
  };

  attempt(() => {
    ensureDir(dir);
    // A bridge that crashed leaves its file; the first one to start afterwards tidies up. A reader
    // never deletes anything.
    const { entries } = readEntries(dir);
    const dead = new Set(
      sweepable(
        entries.map((e) => e.entry),
        now(),
      ),
    );
    for (const { file, entry } of entries) if (dead.has(entry)) rmSync(file, { force: true });
  });
  write();

  const events = ['connected', 'disconnected', 'session'] as const;
  for (const event of events) bridge.on(event, write);
  const timer = setInterval(write, options.heartbeatMs ?? HEARTBEAT_MS);
  // Not the reason a process stays alive: a bridge that is done must be able to exit.
  (timer as { unref?: () => void }).unref?.();

  const remove = () => attempt(() => removeEntry(dir, instance));
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const event of events) bridge.off(event, write);
    remove();
    process.off('exit', stop);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  };
  // Measured on GJS: a signal ends the process WITHOUT running `exit` handlers, so the entry would
  // stay until the heartbeat ran out. A handler for the signal removes it and exits the way the
  // default would have (128 + the signal number). `exit` covers the ordinary end.
  const onInt = () => {
    stop();
    process.exit(130);
  };
  const onTerm = () => {
    stop();
    process.exit(143);
  };
  // `exit` runs synchronously and only synchronous work finishes in it: exactly what `remove` is.
  process.on('exit', stop);
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  return { stop };
}
