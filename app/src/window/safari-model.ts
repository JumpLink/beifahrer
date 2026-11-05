/**
 * Pure half of the Safari row (ADR 0026 §§ 3-4): parsing the Swift helper's one-line stdout, and
 * finding the helper beside the running executable the same way `launcherOf` (core/agents.ts) finds
 * the CLI launcher. No Gio here, so both are tested without a display and without `swiftc`.
 */

import type { Translate } from './i18n.ts';

export type SafariState = 'enabled' | 'disabled' | 'unknown';

/** The real extension's id, never used in a test (ADR 0026 §4: no probe against the live one). */
export const SAFARI_EXTENSION_ID = 'eu.jumplink.beifahrer.Extension';

export interface SafariView {
  /** Only macOS has a Safari row at all (ADR 0026 §3). */
  visible: boolean;
  state: SafariState;
  stateText: string;
  hint: string;
}

/**
 * Read-only, no pause/resume/feature/level (ADR 0017 §2, ADR 0026 §3): `state` is Safari's own
 * answer to "is this extension on", never Beifahrer's policy. Off macOS, or when the helper is
 * missing (dev build, Linux), `state` is already `unknown` by the time it reaches here — this
 * function only turns it into words, it never decides fail-closed itself.
 */
export function safariView(platform: string, state: SafariState, t: Translate): SafariView {
  return {
    visible: platform === 'darwin',
    state,
    stateText: t(`safari.state.${state}`),
    hint: t('safari.hint'),
  };
}

/** Anything other than exactly `enabled` or `disabled` is `unknown` — fail closed, never a crash. */
export function parseSafariState(stdout: string): SafariState {
  const line = stdout.trim();
  return line === 'enabled' || line === 'disabled' ? line : 'unknown';
}

/**
 * `Contents/Helpers/safari-ext-helper` beside the bundle the running executable sits in, or null off
 * macOS or outside a bundle (a checkout, `gjsify run`). The running executable is the carried node
 * (`Contents/Helpers/<name>`), not the launcher (`Contents/MacOS/<name>`) — same ambiguity
 * `launcherOf` already resolves by accepting either.
 */
export function helperPathOf(platform: string, execPath: string | null | undefined): string | null {
  if (platform !== 'darwin' || !execPath) return null;
  const m = /^(.*\.app)\/Contents\/(?:MacOS|Helpers)\/[^/]+$/.exec(execPath);
  return m ? `${m[1]}/Contents/Helpers/safari-ext-helper` : null;
}
