/**
 * What the toolbar button shows, from the extension's state. Pure and exhaustive: the person
 * must be able to tell at a glance whether an agent is in the browser right now, and whether it
 * is stopped. The icon is sparkles (the "AI" motif), drawn from one SVG (extension/icons/):
 *
 *   not connected        monochrome + red dot     no agent can reach this browser at all
 *   paused               monochrome + yellow dot   the person's own stop
 *   "all sites" granted  monochrome + blue dot     a temporary grant is live (ADR 0010)
 *   agent active         the sparkles in colour   a request running, and ACTIVE_MS after
 *   connected, idle      monochrome sparkles      nothing is happening
 *
 * That order is `alarmOf` below, and it is the one the popup's own word and banner follow, so the
 * button and the popup never disagree about what matters most (ADR 0014).
 *
 * The colour never says it alone: the badge text, the tooltip and the popup carry the state in
 * words with it, and every state without a connection has its own reason spelled out in `OFFLINE`.
 *
 * `badge` is only the fallback for a browser that cannot set the icon.
 */

export const ACTIVE_MS = 5_000;

/** Mid-grey: readable on a light and on a dark toolbar alike. */
export const MONOCHROME = '#7f7f86';

export type Connection = 'unpaired' | 'connecting' | 'connected' | 'offline' | 'unauthorized' | 'protocol';

export type ToolbarIcon = 'idle' | 'active' | 'paused' | 'offline' | 'wide' | 'wide-active';

/**
 * The colour each look leads with: the dot for the four that carry one, the sparkles for the two
 * that do not. Adwaita's own palette (red 3, yellow 4, blue 3), because the toolbar button is the
 * one place with no page stylesheet to inherit a theme from. The build draws the dot with it
 * (extension/scripts/icons.ts) and the badge fallback paints the button with it
 * (extension/src/toolbar.ts), so a dot and a badge cannot drift apart.
 */
export const LOOK_COLOUR: Record<ToolbarIcon, string> = {
  idle: MONOCHROME,
  active: '#c061cb',
  paused: '#e5a50a',
  offline: '#e01b24',
  wide: '#3584e4',
  'wide-active': '#3584e4',
};

export interface ToolbarInput {
  connection: Connection;
  paused: boolean;
  /** Requests running right now. */
  inFlight: number;
  /** When the last request finished (ms since epoch), or 0. */
  lastActivityAt: number;
  now: number;
  /** A temporary "all sites" grant is live (ADR 0010). */
  wide?: boolean;
}

export interface ToolbarLook {
  icon: ToolbarIcon;
  /** Badge text, for a browser that has setBadgeText but no setIcon. */
  badge: '' | 'AI' | 'II' | '!' | '*';
  title: string;
}

/**
 * The one thing the person has to act on, loudest first.
 *
 * `disconnected` outranks `paused` because without a bridge connection the extension does nothing
 * at all: a pause, a live grant and an idle icon behind it are all ways of saying nothing can
 * reach this browser, and only one of them can be fixed from where the person is looking (ADR
 * 0014). A pause still outranks every connected look, and `alarmOf` answers `none` for those, so a
 * caller can ask this once instead of repeating the order.
 */
export type Alarm = 'disconnected' | 'paused' | 'none';

export function alarmOf(input: Pick<ToolbarInput, 'connection' | 'paused'>): Alarm {
  if (input.connection !== 'connected') return 'disconnected';
  return input.paused ? 'paused' : 'none';
}

export function isActive(input: Pick<ToolbarInput, 'inFlight' | 'lastActivityAt' | 'now'>): boolean {
  return input.inFlight > 0 || (input.lastActivityAt > 0 && input.now - input.lastActivityAt < ACTIVE_MS);
}

export function toolbarLook(input: ToolbarInput): ToolbarLook {
  const alarm = alarmOf(input);
  if (alarm === 'disconnected') {
    // The guard has already proven the connection is not 'connected', which is exactly the key
    // union OFFLINE has: the cast narrows the type, it does not decide anything.
    const reason = OFFLINE[input.connection as Exclude<Connection, 'connected'>];
    return { icon: 'offline', badge: '!', title: `Beifahrer — ${reason}` };
  }
  if (alarm === 'paused') {
    return {
      icon: 'paused',
      badge: 'II',
      title: 'Beifahrer is paused — the agent gets nothing from this browser. Click to resume.',
    };
  }
  if (input.wide) {
    // No connection check here: `alarmOf` has already answered for every state but 'connected'.
    return isActive(input)
      ? {
          icon: 'wide-active',
          badge: '*',
          title: 'Beifahrer — an agent is working, with access to all sites for now. Click to end it.',
        }
      : {
          icon: 'wide',
          badge: '*',
          title: 'Beifahrer — access to all sites is on for now. Click to end it.',
        };
  }
  if (isActive(input)) {
    return {
      icon: 'active',
      badge: 'AI',
      title: 'Beifahrer — an agent is using this browser right now. Click to see what, or to stop it.',
    };
  }
  return {
    icon: 'idle',
    badge: '',
    title: 'Beifahrer — connected to an agent, idle. Click to see the activity or pause.',
  };
}

const OFFLINE: Record<Exclude<Connection, 'connected'>, string> = {
  unpaired: 'not paired yet. No agent can reach this browser.',
  connecting: 'connecting to the bridge…',
  offline: 'not connected. No agent can reach this browser.',
  unauthorized: 'the bridge refused the pairing token. No agent can reach this browser.',
  protocol: 'bridge and extension versions do not match. No agent can reach this browser.',
};
