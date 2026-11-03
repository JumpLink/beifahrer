/**
 * Starting the window at login, and what the person is asked (ADR 0024 § 4). Pure: no portal, no
 * widget, no file, so every rule is tested without a display.
 *
 * Only the Flatpak has a way to do it today (the Background portal's `autostart` flag). Everywhere
 * else the backend is `none`, and then the window neither shows the switch nor asks: a question the
 * app cannot act on would be a lie.
 */

/** Added to the window's command line by the autostart entry; the person never types it. */
export const BACKGROUND_FLAG = '--background';

/** `portal` is the Background portal inside the Flatpak; `none` has no autostart at all (yet). */
export type AutostartBackend = 'portal' | 'none';

export function autostartBackend(flatpak: boolean, platform: string): AutostartBackend {
  return flatpak && platform === 'linux' ? 'portal' : 'none';
}

export interface AutostartState {
  /** The person has it on, and the portal granted it. */
  enabled: boolean;
  /** The question after the first pairing was answered, yes or no. It is never asked twice. */
  asked: boolean;
}

export const OFF: AutostartState = { enabled: false, asked: false };

/**
 * The stored file. Fail closed: anything but a literal `true` is `false`, so a damaged or hand-edited
 * file means "off" and, at worst, one more question, never an autostart nobody asked for.
 */
export function parseState(text: string | null): AutostartState {
  if (text === null) return OFF;
  try {
    const autostart = (JSON.parse(text) as { autostart?: Record<string, unknown> } | null)?.autostart;
    return { enabled: autostart?.enabled === true, asked: autostart?.asked === true };
  } catch {
    return OFF;
  }
}

export function serializeState(state: AutostartState): string {
  return `${JSON.stringify({ autostart: { enabled: state.enabled, asked: state.asked } }, null, 2)}\n`;
}

/** The switch exists only where turning it on does something. */
export function showSwitch(backend: AutostartBackend): boolean {
  return backend !== 'none';
}

/**
 * Ask once, when the first browser has actually connected (`paired`) and never again after any answer:
 * "No" is remembered, and a person who changed their mind has the switch.
 */
export function shouldAsk(backend: AutostartBackend, state: AutostartState, paired: boolean): boolean {
  return showSwitch(backend) && paired && !state.asked;
}

/** What is stored after the question or the switch. `granted` is the portal's answer to turning it on. */
export function afterAnswer(wantOn: boolean, granted: boolean): AutostartState {
  return { asked: true, enabled: wantOn && granted };
}

/** After the question: the stored state, and whether a "yes" met a refusal the person must be told about. */
export function afterQuestion(
  yes: boolean,
  answer: 'granted' | 'denied' | 'unavailable',
): { state: AutostartState; refused: boolean } {
  const state = afterAnswer(yes, answer === 'granted');
  return { state, refused: yes && !state.enabled };
}

/** The flag, and the arguments without it (GApplication rejects an option it does not know). */
export function withoutFlag(args: readonly string[]): { requested: boolean; rest: string[] } {
  return { requested: args.includes(BACKGROUND_FLAG), rest: args.filter((a) => a !== BACKGROUND_FLAG) };
}

/**
 * Hidden only when the entry that started us is one we wrote and the portal still stands behind it:
 * the flag alone (typed by hand, or a stale entry) shows the window, because a hidden process nobody
 * can find is worse than a window nobody wanted (ADR 0024 § 2).
 */
export function startsHidden(requested: boolean, backend: AutostartBackend, state: AutostartState): boolean {
  return requested && backend === 'portal' && state.enabled;
}

/** The command the portal writes into the autostart entry; the first element is the Flatpak's command. */
export function autostartCommandline(binary: string = 'beifahrer'): string[] {
  return [binary, BACKGROUND_FLAG];
}
