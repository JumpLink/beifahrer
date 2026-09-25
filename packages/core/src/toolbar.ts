/**
 * What the toolbar button shows, from the extension's state. Pure and exhaustive: the person
 * must be able to tell at a glance whether an agent is in the browser right now, and whether it
 * is stopped. The icon is sparkles (the "AI" motif), drawn from one SVG (extension/icons/):
 *
 *   connected, idle          monochrome sparkles
 *   agent active             the sparkles in colour (a request running, and ACTIVE_MS after)
 *   paused                   monochrome + red dot — whatever the connection or activity
 *   not paired / no bridge   monochrome + amber dot
 *   "all sites" granted      a blue dot, over the idle or active look (ADR 0010); beats no bridge,
 *                            because the grant is live whether or not an agent is connected
 *
 * `badge` is only the fallback for a browser that cannot set the icon.
 */

export const ACTIVE_MS = 5_000;

export type Connection = 'unpaired' | 'connecting' | 'connected' | 'offline' | 'unauthorized' | 'protocol';

export type ToolbarIcon = 'idle' | 'active' | 'paused' | 'offline' | 'wide' | 'wide-active';

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

export function isActive(input: Pick<ToolbarInput, 'inFlight' | 'lastActivityAt' | 'now'>): boolean {
  return input.inFlight > 0 || (input.lastActivityAt > 0 && input.now - input.lastActivityAt < ACTIVE_MS);
}

export function toolbarLook(input: ToolbarInput): ToolbarLook {
  if (input.paused) {
    return {
      icon: 'paused',
      badge: 'II',
      title: 'beifahrer is paused — the agent gets nothing from this browser. Click to resume.',
    };
  }
  if (input.wide) {
    return isActive(input) && input.connection === 'connected'
      ? {
          icon: 'wide-active',
          badge: '*',
          title: 'beifahrer — an agent is working, with access to all sites for now. Click to end it.',
        }
      : {
          icon: 'wide',
          badge: '*',
          title: 'beifahrer — access to all sites is on for now. Click to end it.',
        };
  }
  if (input.connection !== 'connected') {
    return { icon: 'offline', badge: '!', title: `beifahrer — ${OFFLINE[input.connection]}` };
  }
  if (isActive(input)) {
    return {
      icon: 'active',
      badge: 'AI',
      title: 'beifahrer — an agent is using this browser right now. Click to see what, or to stop it.',
    };
  }
  return {
    icon: 'idle',
    badge: '',
    title: 'beifahrer — connected to an agent, idle. Click to see the activity or pause.',
  };
}

const OFFLINE: Record<Exclude<Connection, 'connected'>, string> = {
  unpaired: 'not paired yet. No agent can reach this browser.',
  connecting: 'connecting to the bridge…',
  offline: 'no agent running. Nothing can reach this browser.',
  unauthorized: 'the bridge refused the pairing token. No agent can reach this browser.',
  protocol: 'bridge and extension versions do not match. No agent can reach this browser.',
};
