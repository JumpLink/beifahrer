/**
 * Pure half of the Safari row (ADR 0026 §§ 3-4): parsing the Swift main's one-line `--safari-ext`
 * stdout, and finding that main beside the running executable the same way `launcherOf` (core/agents.ts) finds
 * the CLI launcher. No Gio here, so both are tested without a display and without `swiftc`.
 */

import type { Translate } from './i18n.ts';

export type SafariState = 'enabled' | 'disabled' | 'unknown';

/** The real extension's id, never used in a test (ADR 0026 §4: no probe against the live one). */
export const SAFARI_EXTENSION_ID = 'eu.jumplink.beifahrer.Extension';

export interface SafariView {
  /** Only macOS, and only with the helper in the bundle, has a Safari row at all (ADR 0026 §3). */
  visible: boolean;
  state: SafariState;
  stateText: string;
  hint: string;
}

/**
 * Read-only, no pause/resume/feature/level (ADR 0017 §2, ADR 0026 §3): `state` is Safari's own
 * answer to "is this extension on", never Beifahrer's policy. `hasHelper` is `helperPathOf(...)
 * !== null` — without the helper there is nothing this row could ever read or open, so it stays
 * hidden rather than showing "Unknown" (fail closed, no error dialog, ADR 0026 § 3/Stufenplan:
 * Safari is one optional browser among others, never a requirement).
 */
export function safariView(
  platform: string,
  hasHelper: boolean,
  state: SafariState,
  t: Translate,
): SafariView {
  return {
    visible: platform === 'darwin' && hasHelper,
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
 * The app's own Mach-O main, `Contents/MacOS/beifahrer`, of the bundle the running executable sits
 * in, or null off macOS or outside a bundle (a checkout, `gjsify run`). Only that binary — the
 * bundle's CFBundleExecutable — gets an answer from SafariServices (ADR 0026, amendment
 * 2026-11-07); it takes `--safari-ext …` itself and hands everything else to the launcher. The
 * running executable is the carried node (`Contents/Helpers/<name>`), not the main — same
 * ambiguity `launcherOf` already resolves by accepting either.
 */
export function helperPathOf(platform: string, execPath: string | null | undefined): string | null {
  if (platform !== 'darwin' || !execPath) return null;
  const m = /^(.*\.app)\/Contents\/(?:MacOS|Helpers)\/[^/]+$/.exec(execPath);
  return m ? `${m[1]}/Contents/MacOS/beifahrer` : null;
}
