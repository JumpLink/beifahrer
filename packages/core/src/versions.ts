/**
 * Is the connected extension older than the app that talks to it (issue #210)?
 *
 * One product version covers the extension and the app (docs/conventions.md), so a difference is a
 * stale install, not a design. An agent that meets an error caused by an old extension cannot tell
 * it from a page problem; this gives it the sentence. Pure: the bridge supplies both versions.
 */

/** `x.y.z` as numbers, or null for anything else (a dev build, an empty string). */
export function parseVersion(value: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when BOTH parse and the extension is strictly older: unknown never claims "outdated". */
export function extensionIsOlder(extension: string, app: string): boolean {
  const e = parseVersion(extension);
  const a = parseVersion(app);
  if (!e || !a) return false;
  for (let i = 0; i < 3; i++) {
    if (e[i]! !== a[i]!) return e[i]! < a[i]!;
  }
  return false;
}

/** The sentence for an agent, or null when there is nothing to say. */
export function outdatedExtensionNote(extension: string, app: string): string | null {
  return extensionIsOlder(extension, app)
    ? `The connected extension is ${extension} and this Beifahrer is ${app}. The extension is outdated: ` +
        'an error that looks like a page problem may be a method or fix it does not have yet. ' +
        'Tell the person to update the extension; do not retry.'
    : null;
}
