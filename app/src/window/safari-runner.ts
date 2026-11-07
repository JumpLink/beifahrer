/**
 * Runs the app's Swift main executable in its `--safari-ext` mode (ADR 0026 § 4) via
 * `Gio.Subprocess`, one argv array, no shell. `readSafariState` is safe to call on its own, since it
 * only reads Safari's own state and fails closed to `unknown` on any error — a missing binary, a
 * spawn failure, a non-zero exit or Safari's own `SFErrorDomain`, all read the same way.
 * `openSafariSettings` opens Safari's Settings UI and must only ever run from the person's own click
 * (ADR 0026 § 4), never probed or called automatically; this module does not decide that, its one
 * caller (safari-row.ts) does.
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { parseSafariState, type SafariState } from './safari-model.ts';

function run(helperPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!GLib.file_test(helperPath, GLib.FileTest.IS_EXECUTABLE)) {
      reject(new Error('helper not found'));
      return;
    }
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
    });
    let proc: Gio.Subprocess;
    try {
      proc = launcher.spawnv([helperPath, ...args]);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    proc.communicate_utf8_async(null, null, (_p, res) => {
      try {
        const [, stdout] = proc.communicate_utf8_finish(res);
        resolve(stdout ?? '');
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export function readSafariState(helperPath: string, extensionId: string): Promise<SafariState> {
  return run(helperPath, ['--safari-ext', 'state', extensionId])
    .then(parseSafariState)
    .catch(() => 'unknown' as SafariState);
}

/** Fire-and-forget: there is nothing useful to show for a failure here, and nothing to retry. */
export function openSafariSettings(helperPath: string, extensionId: string): void {
  run(helperPath, ['--safari-ext', 'open-settings', extensionId]).catch(() => {});
}
