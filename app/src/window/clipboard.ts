/**
 * Plain text onto the system clipboard, for every page that has something to copy.
 *
 * As bytes in a `Gdk.ContentProvider`: `Gdk.Clipboard.set` takes a GValue, which GJS and node-gi fill
 * differently (docs/desktop-app-spikes.md S4). False when there is no display clipboard.
 */

import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';

export function copyText(text: string): boolean {
  const clipboard = Gdk.Display.get_default()?.get_clipboard();
  if (!clipboard) return false;
  clipboard.set_content(
    Gdk.ContentProvider.new_for_bytes(
      'text/plain;charset=utf-8',
      new GLib.Bytes(new TextEncoder().encode(text)),
    ),
  );
  return true;
}
