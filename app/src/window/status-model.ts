/**
 * What the status window shows, from the registry's status. Pure: no widget, no file, no clock, so
 * the words and the ladder are tested without a display.
 *
 * The ladder is `presenceOf` in core (ADR 0015 §5). The first two rungs are alarms in the sense of
 * ADR 0014: a missing connection is not a quiet state, so the window says what to do instead of
 * showing an empty list. Pause and "all sites" come from what the extension reported (ADR 0030);
 * a browser that reported nothing is "pause unknown" and never shown as running. There is no field
 * for a control: only the person resumes, in the browser (ADR 0005).
 */

import {
  presenceOf,
  type Presence,
  type RegistryBrowser,
  type RegistryStatus,
  type Standing,
} from '@beifahrer/core';

import type { Translate } from './i18n.ts';

export interface SessionRow {
  /** "claude-code · werkstatt". */
  title: string;
  /** "Port 47813 · Firefox 155.0, Chromium 140.0", or the port and "no browser". */
  subtitle: string;
}

export interface StatusView {
  /** The two states the person has to act on. `ready` is the quiet one. */
  alarm: boolean;
  presence: Presence;
  /** The finer rung of ADR 0030 (paused, pause unknown). */
  standing: Standing;
  /** "All sites are open for now" while a connected browser reports a wildcard grant, else null. */
  badge: string | null;
  title: string;
  description: string;
  sessions: SessionRow[];
  /** A line about registry files that could not be read, or null. */
  note: string | null;
  /** Zero or one: ports where something listens that no session announced. */
  warnings: { title: string; description: string }[];
}

/** The catalog's name for each rung. */
const KEY = {
  'no-bridge': 'nobridge',
  'no-browser': 'nobrowser',
  paused: 'paused',
  'ready-unknown': 'readyunknown',
  ready: 'ready',
} as const;

function browserText(b: RegistryBrowser, t: Translate): string {
  const key =
    b.paused === true
      ? 'session.browser.paused'
      : b.paused === false
        ? 'session.browser'
        : 'session.browser.unknown';
  return t(key, { name: b.name, version: b.version });
}

export function viewOf(
  status: RegistryStatus,
  skipped: number,
  t: Translate,
  unregistered: readonly number[] = [],
): StatusView {
  const { presence } = status;
  const standing = presenceOf(status.sessions);
  const browsers = status.sessions.flatMap((s) => s.browsers);
  const pausedIn = [...new Set(browsers.filter((b) => b.paused === true).map((b) => b.name))].join(', ');
  return {
    alarm: presence !== 'ready' || standing === 'paused',
    presence,
    standing,
    badge: browsers.some((b) => b.allSites === true) ? t('status.allsites') : null,
    title: t(`status.${KEY[standing]}.title`),
    description: t(`status.${KEY[standing]}.description`, { browsers: pausedIn }),
    sessions: status.sessions.map((s) => ({
      title: s.label,
      subtitle: [
        t('session.port', { port: s.port }),
        s.browsers.length === 0
          ? t('session.nobrowser')
          : s.browsers.map((b) => browserText(b, t)).join(', '),
      ].join(' · '),
    })),
    note: skipped > 0 ? t('unreadable', { count: skipped }) : null,
    warnings:
      unregistered.length > 0
        ? [
            {
              title: t(unregistered.length === 1 ? 'foreign.one' : 'foreign.many', {
                ports: unregistered.join(', '),
              }),
              description: t('foreign.description'),
            },
          ]
        : [],
  };
}
