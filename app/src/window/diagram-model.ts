/**
 * What the connection diagram on the Status page shows (ADR 0025), from the registry. Pure: the clock
 * comes in as an argument, so the states, the wait that runs out and the words under a failing link
 * are tested without a display.
 *
 * The window looks out of the middle node: it sees agent sessions (link 1) and the browsers they
 * list (link 2), and nothing else. What it cannot see is drawn `unknown` and never as a failure: a
 * connecting browser, a refused token and a pause are not in the registry (ADR 0015 § 5).
 */

import type { RegistryEntry } from '@beifahrer/core';

import type { Translate } from './i18n.ts';

export type LinkState = 'ok' | 'wait' | 'fail' | 'unknown';

/** Link 1 `wait` is "the AI app has not introduced itself yet"; past this it is a crashed app (§ 13.3). */
export const WAIT_MS = 10_000;
/** The most names written under a stack; the rest is "+ n more". */
const MAX_NAMES = 2;
/** The artwork draws at most this many cards in a stack. */
const MAX_CARDS = 3;

/** The vertical arrangement's cells (rows of `VERTICAL_UNIT` px): app, link 1, Beifahrer, link 2, browser. */
export const VERTICAL_CELLS = [11, 8, 11, 9, 10] as const;
export const VERTICAL_UNIT = 10;

/** "claude-code · werkstatt" as the bold part and the dim rest; a name without " · " has no rest. */
export function splitName(name: string): { main: string; rest: string | null } {
  const at = name.indexOf(' · ');
  return at < 0 ? { main: name, rest: null } : { main: name.slice(0, at), rest: name.slice(at + 3) };
}

/** What the button under a failing link does. */
export type DiagramAction = 'setup' | 'token';

export interface NodeLabels {
  /** Written bold under the node, at most `MAX_NAMES`. */
  names: string[];
  /** A name that is no longer connected: drawn dim, after the others. */
  gone: string | null;
  /** "+ 2 more", or null. */
  more: string | null;
  /** "1 of 2 connected", or null. */
  caption: string | null;
}

export interface DiagramView {
  link1: LinkState;
  link2: LinkState;
  /** The class list for the SVG root, without `dark` (that follows the theme, not the registry). */
  classes: string[];
  /** "Connected", "Not connected": the word under each link. */
  captions: { link1: string; link2: string };
  app: NodeLabels;
  browser: NodeLabels;
  /** One plain sentence and at most one button, under the loudest failing link; null when nothing fails. */
  fix: { sentence: string; action: { id: DiagramAction; label: string } | null } | null;
}

/** The browsers seen last time and the ones that have gone since, by connection id. */
export interface BrowserMemory {
  seen: ReadonlyMap<string, string>;
  gone: ReadonlyMap<string, string>;
}

export const NO_BROWSERS: BrowserMemory = { seen: new Map(), gone: new Map() };

/** The connected browsers of all sessions, once each. */
export function connectedBrowsers(sessions: readonly RegistryEntry[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const s of sessions) for (const b of s.browsers) found.set(b.id, b.name);
  return found;
}

/**
 * The registry only lists browsers that are connected, so "one of them left" is the difference to
 * the last look: the window remembers. A browser that returns is no longer gone; with none left
 * connected there is nothing to be half of, and the memory is dropped.
 */
export function trackBrowsers(previous: BrowserMemory, current: ReadonlyMap<string, string>): BrowserMemory {
  if (current.size === 0) return NO_BROWSERS;
  const gone = new Map(previous.gone);
  for (const [id, name] of previous.seen) if (!current.has(id)) gone.set(id, name);
  for (const id of current.keys()) gone.delete(id);
  return { seen: current, gone };
}

/** The client part of "claude-code · werkstatt"; the default before the handshake is "mcp". */
const introduced = (label: string) => label.split(' · ')[0]!.trim() !== 'mcp';

/**
 * Link 1. A bridge binds its port before the MCP client says who it is; until then its label still
 * carries the default client name "mcp" and the link is `wait`. After `WAIT_MS` since the session
 * started it is `fail`: an app that never ran `initialize`. (A label set by the person hides this, so
 * the window then reads it as introduced.)
 */
export function linkOne(
  sessions: readonly RegistryEntry[],
  now: Date,
  readable: { skipped: number; unregistered: number },
): LinkState {
  if (sessions.length === 0) return readable.skipped > 0 || readable.unregistered > 0 ? 'unknown' : 'fail';
  if (sessions.some((s) => introduced(s.label))) return 'ok';
  return sessions.some((s) => now.getTime() - Date.parse(s.startedAt) < WAIT_MS) ? 'wait' : 'fail';
}

/** Link 2: a browser on any session. No session means nothing to ask, so the window cannot say. */
export function linkTwo(sessions: readonly RegistryEntry[]): LinkState {
  if (sessions.length === 0) return 'unknown';
  return sessions.some((s) => s.browsers.length > 0) ? 'ok' : 'fail';
}

const more = (count: number, t: Translate) => (count > 0 ? t('diagram.more', { count }) : null);

export function diagramOf(
  sessions: readonly RegistryEntry[],
  skipped: number,
  unregistered: readonly number[],
  memory: BrowserMemory,
  now: Date,
  t: Translate,
): DiagramView {
  const link1 = linkOne(sessions, now, { skipped, unregistered: unregistered.length });
  const link2 = linkTwo(sessions);
  const connected = [...connectedBrowsers(sessions).values()];
  const gone = connected.length > 0 ? ([...memory.gone.values()][0] ?? null) : null;
  const browsers = connected.length + (gone === null ? 0 : 1);

  const classes = [`l1-${link1}`, `l2-${link2}`, 'here-window'];
  if (sessions.length > 1) classes.push(`stacked-${Math.min(sessions.length, MAX_CARDS)}`);
  if (browsers > 1) classes.push(`browsers-${Math.min(browsers, MAX_CARDS)}`);
  if (gone !== null) classes.push('browser-gone');

  let fix: DiagramView['fix'] = null;
  if (link1 === 'fail') {
    fix = {
      sentence: t(sessions.length === 0 ? 'diagram.fix.nobridge' : 'diagram.fix.stalled'),
      action: { id: 'setup', label: t('diagram.fix.nobridge.action') },
    };
  } else if (link1 === 'unknown' && skipped > 0) {
    fix = { sentence: t('diagram.fix.unreadable'), action: null };
  } else if (link2 === 'fail') {
    fix = {
      sentence: t('diagram.fix.nobrowser'),
      action: { id: 'token', label: t('diagram.fix.nobrowser.action') },
    };
  } else if (gone !== null) {
    fix = {
      sentence: t('diagram.fix.partial', { name: gone }),
      action: { id: 'token', label: t('diagram.fix.nobrowser.action') },
    };
  }

  return {
    link1,
    link2,
    classes,
    captions: { link1: t(`diagram.link.${link1}`), link2: t(`diagram.link.${link2}`) },
    app: {
      names: sessions.slice(0, MAX_NAMES).map((s) => s.label),
      gone: null,
      more: more(sessions.length - MAX_NAMES, t),
      caption: null,
    },
    browser: {
      names: connected.slice(0, MAX_NAMES),
      gone,
      more: more(connected.length - MAX_NAMES, t),
      caption: gone === null ? null : t('diagram.partial', { connected: connected.length, total: browsers }),
    },
    fix,
  };
}

/**
 * The artwork as the image loader wants it: the state as the root's class list and a size of `scale`
 * times the drawing's own, so a HiDPI screen gets more pixels than the 600×100 the viewBox says.
 * Only the root element is touched.
 */
export function prepareSvg(source: string, classes: readonly string[], dark: boolean, scale = 2): string {
  return source
    .replace(
      /(<svg\b[^>]*?\bwidth=")(\d+)(" height=")(\d+)/,
      (_, a, w, b, h) => `${a}${Number(w) * scale}${b}${Number(h) * scale}`,
    )
    .replace(/(<svg\b[^>]*?\bclass=")[^"]*(")/, `$1${[...classes, ...(dark ? ['dark'] : [])].join(' ')}$2`);
}
