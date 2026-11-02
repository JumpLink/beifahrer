/**
 * Calls `onChange` when the registry directory may have changed: at once when `Gio.FileMonitor` says
 * so, and at least every `POLL_MS` regardless (ADR 0015 §4).
 *
 * The poll is not a fallback for a broken monitor, it is half of the design: the directory may not
 * exist yet when the window opens (no bridge has ever run) and a monitor cannot watch what is not
 * there, and a monitor has only been measured on macOS. Attaching is retried on every tick.
 * Events are debounced, because an atomic write reports several.
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export const POLL_MS = 2_000;
const DEBOUNCE_MS = 100;

export function watchRegistry(dir: string, onChange: () => void): () => void {
  let monitor: Gio.FileMonitor | null = null;
  let pending = 0;

  const soon = () => {
    if (pending) return;
    pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
      pending = 0;
      onChange();
      return GLib.SOURCE_REMOVE;
    });
  };

  const attach = () => {
    if (monitor || !GLib.file_test(dir, GLib.FileTest.IS_DIR)) return;
    try {
      monitor = Gio.File.new_for_path(dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
      monitor.connect('changed', soon);
    } catch {
      monitor = null;
    }
  };

  attach();
  const tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
    attach();
    onChange();
    return GLib.SOURCE_CONTINUE;
  });

  return () => {
    GLib.source_remove(tick);
    if (pending) GLib.source_remove(pending);
    monitor?.cancel();
  };
}
