/**
 * What the status window shows, from the registry's status. Pure: no widget, no file, no clock, so
 * the words and the ladder are tested without a display.
 *
 * The ladder is `presenceOf` in core (ADR 0015 §5). The first two rungs are alarms in the sense of
 * ADR 0014: a missing connection is not a quiet state, so the window says what to do instead of
 * showing an empty list. Pause and "all sites" are not here, because the bridge does not know them;
 * the toolbar button is where the person sees those.
 */

import type { Presence, RegistryStatus } from '@beifahrer/core';

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
  /** An icon name that `@gjsify/adwaita-app` bundles. */
  icon: string;
  title: string;
  description: string;
  sessions: SessionRow[];
  /** A line about registry files that could not be read, or null. */
  note: string | null;
  /** Zero or one: ports where something listens that no session announced. */
  warnings: { title: string; description: string }[];
}

const ICON: Record<Presence, string> = {
  'no-bridge': 'dialog-warning-symbolic',
  'no-browser': 'dialog-warning-symbolic',
  ready: 'emblem-ok-symbolic',
};

/** The catalog's name for each rung. */
const KEY = { 'no-bridge': 'nobridge', 'no-browser': 'nobrowser', ready: 'ready' } as const;

export function viewOf(
  status: RegistryStatus,
  skipped: number,
  t: Translate,
  unregistered: readonly number[] = [],
): StatusView {
  const { presence } = status;
  return {
    alarm: presence !== 'ready',
    presence,
    icon: ICON[presence],
    title: t(`status.${KEY[presence]}.title`),
    description: t(`status.${KEY[presence]}.description`),
    sessions: status.sessions.map((s) => ({
      title: s.label,
      subtitle: [
        t('session.port', { port: s.port }),
        s.browsers.length === 0
          ? t('session.nobrowser')
          : s.browsers.map((b) => t('session.browser', { name: b.name, version: b.version })).join(', '),
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
