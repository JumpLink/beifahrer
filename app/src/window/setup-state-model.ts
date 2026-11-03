/**
 * Whether the person is through the setup assistant, and which view the window opens on (ADR 0023 § 6).
 * Pure: no file, no widget. The flag is stored by Beifahrer itself because the agents' config files,
 * the old signal, are unreadable from inside a Flatpak.
 */

export type StartView = 'setup' | 'tabs';

/** Fail closed to "not done": anything but a literal `true` shows the assistant once more, nothing worse. */
export function parseSetupDone(text: string | null): boolean {
  if (text === null) return false;
  try {
    return (JSON.parse(text) as { setup?: { done?: unknown } } | null)?.setup?.done === true;
  } catch {
    return false;
  }
}

/**
 * The assistant takes the window until setup is finished. `agentConfigured` (an agent's config names
 * Beifahrer) only adds a hint for installs that can read those files; it never is the only signal.
 */
export function isSetupFinished(done: boolean, agentConfigured: boolean): boolean {
  return done || agentConfigured;
}

export function startView(done: boolean, agentConfigured: boolean): StartView {
  return isSetupFinished(done, agentConfigured) ? 'tabs' : 'setup';
}

/** Pairing is the real end of setup: the first connected browser marks it, once. */
export function shouldMarkDone(done: boolean, paired: boolean): boolean {
  return paired && !done;
}

/**
 * `existing` with one top-level section replaced and every other section kept, because the file is
 * shared (autostart and setup). A damaged file is replaced by a fresh one.
 */
export function mergeSection(existing: string | null, key: string, value: unknown): string {
  let root: Record<string, unknown> = {};
  try {
    const parsed: unknown = existing === null ? null : JSON.parse(existing);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      root = parsed as Record<string, unknown>;
  } catch {
    root = {};
  }
  return `${JSON.stringify({ ...root, [key]: value }, null, 2)}\n`;
}
