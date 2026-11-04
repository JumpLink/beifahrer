/**
 * What the toolbar button shows, from the extension's state. Pure and exhaustive: the person
 * must be able to tell at a glance whether an agent is in the browser right now, and whether it
 * is stopped. The icon is the Beifahrer bus, drawn from the app icon (data/icons/):
 *
 *   not connected        monochrome + red dot     no agent can reach this browser at all
 *   paused               monochrome + yellow dot   the person's own stop
 *   "all sites" granted  monochrome + blue dot     a temporary grant is live (ADR 0010)
 *   agent active         the bus in colour + green dot  a request running, and ACTIVE_MS after
 *   connected, idle      monochrome + green dot    nothing is happening
 *
 * That order is `alarmOf` below, and it is the one the popup's own word and banner follow, so the
 * button and the popup never disagree about what matters most (ADR 0014).
 *
 * The colour never says it alone: the tooltip and the popup carry the state in words with it, and
 * every state without a connection has its own reason spelled out in `OFFLINE`. There is no
 * toolbar badge: Firefox draws it over the 16 px icon and hides the bus (ADR 0025 § 11).
 */

export const ACTIVE_MS = 5_000;

/**
 * The monochrome bus follows the toolbar's own icon colour, measured from Firefox on GNOME
 * (2026-11-04): `dark` ink for a light toolbar (Adwaita's rgba(0,0,6,.8) on white), `light` ink
 * for a dark one.
 */
export const TOOLBAR_INK = { dark: '#333338', light: '#ffffff' } as const;
export type ToolbarInk = keyof typeof TOOLBAR_INK;

/** `#rgb`, `#rrggbb`, `rgb()`/`rgba()` or a `[r, g, b]` array, as a WebExtension theme gives them. */
export function parseThemeColour(value: unknown): [number, number, number] | null {
  if (Array.isArray(value)) {
    const [r, g, b] = value;
    return [r, g, b].every((n) => typeof n === 'number' && n >= 0 && n <= 255) ? [r, g, b] : null;
  }
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value.trim());
  if (fn) {
    const rgb = [fn[1], fn[2], fn[3]].map(Number);
    return rgb.every((n) => n <= 255) ? (rgb as [number, number, number]) : null;
  }
  return null;
}

/** Light text on the toolbar means a dark toolbar, so the `light` ink; null when the colour is unreadable. */
export function inkForThemeColour(value: unknown): ToolbarInk | null {
  const rgb = parseThemeColour(value);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128 ? 'light' : 'dark';
}

/** Adwaita green 5: the dot of a connected look, the only state signal left on the button. */
export const CONNECTED = '#26a269';

export type Connection = 'unpaired' | 'connecting' | 'connected' | 'offline' | 'unauthorized' | 'protocol';

export type ToolbarIcon = 'idle' | 'active' | 'paused' | 'offline' | 'wide' | 'wide-active';

/**
 * The dot colour of every look: green while connected, red, yellow and blue for the loud ones. Adwaita's own palette (red 3, yellow 4, blue 3), because the toolbar button is the
 * one place with no page stylesheet to inherit a theme from. The icon build draws the dot with it
 * (extension/scripts/icons.ts).
 */
export const LOOK_COLOUR: Record<ToolbarIcon, string> = {
  idle: CONNECTED,
  active: CONNECTED,
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
    return { icon: 'offline', title: `Beifahrer — ${reason}` };
  }
  if (alarm === 'paused') {
    return {
      icon: 'paused',
      title: 'Beifahrer is paused — the agent gets nothing from this browser. Click to resume.',
    };
  }
  if (input.wide) {
    // No connection check here: `alarmOf` has already answered for every state but 'connected'.
    return isActive(input)
      ? {
          icon: 'wide-active',
          title: 'Beifahrer — an agent is working, with access to all sites for now. Click to end it.',
        }
      : {
          icon: 'wide',
          title: 'Beifahrer — access to all sites is on for now. Click to end it.',
        };
  }
  if (isActive(input)) {
    return {
      icon: 'active',
      title: 'Beifahrer — an agent is using this browser right now. Click to see what, or to stop it.',
    };
  }
  return {
    icon: 'idle',
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
