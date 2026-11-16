/**
 * The bridge side's own settings (ADR 0017 § 8): the loopback port range, the `--allow-write` default
 * of the Agent page's snippet, the window's language. Pure: no file, no widget, so every rule is tested
 * without a display.
 *
 * Nothing here is policy. There is no field that pauses, switches a feature or sets a site level, and
 * a test pins the field list so one cannot be added by accident (ADR 0005).
 *
 * Fail closed, field by field: a damaged or hand-edited file yields the defaults for what is wrong and
 * keeps what is right, and a port outside what `parsePortRange` accepts is "not set", never a wider range.
 */

import {
  DEFAULT_PORT,
  DEFAULT_PORT_COUNT,
  MAX_PORT_COUNT,
  parsePortRange,
  type PortRange,
} from '@beifahrer/core';

export type Language = 'system' | 'en' | 'de';
export const LANGUAGES: readonly Language[] = ['system', 'en', 'de'];

export interface Settings {
  /** First port of the range; null = the default. */
  port: number | null;
  /** Ports in the range; null = the default. */
  portCount: number | null;
  /** The Agent page starts with "Allow filling and clicking" on. It only pre-selects a snippet. */
  allowWrite: boolean;
  language: Language;
}

export const DEFAULT_SETTINGS: Settings = {
  port: null,
  portCount: null,
  allowWrite: false,
  language: 'system',
};

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

const validPort = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= MIN_PORT && raw <= MAX_PORT ? raw : null;
const validCount = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_PORT_COUNT ? raw : null;

/** The range must end at 65535 at the latest; a count that would run past it is not set. */
function settled(port: number | null, portCount: number | null): Pick<Settings, 'port' | 'portCount'> {
  const base = port ?? DEFAULT_PORT;
  const count = portCount ?? DEFAULT_PORT_COUNT;
  return base + count - 1 > MAX_PORT ? { port, portCount: null } : { port, portCount };
}

export function parseSettings(text: string | null): Settings {
  if (text === null) return DEFAULT_SETTINGS;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return DEFAULT_SETTINGS;
  const r = root as {
    ports?: { base?: unknown; count?: unknown };
    agent?: { allowWrite?: unknown };
    language?: unknown;
  };
  const ports = r.ports !== null && typeof r.ports === 'object' ? r.ports : {};
  const agent = r.agent !== null && typeof r.agent === 'object' ? r.agent : {};
  return {
    ...settled(validPort(ports.base), validCount(ports.count)),
    allowWrite: agent.allowWrite === true,
    language: r.language === 'en' || r.language === 'de' ? r.language : 'system',
  };
}

export function serializeSettings(s: Settings): string {
  const ports: Record<string, number> = {};
  if (s.port !== null) ports.base = s.port;
  if (s.portCount !== null) ports.count = s.portCount;
  const out: Record<string, unknown> = {};
  if (Object.keys(ports).length > 0) out.ports = ports;
  if (s.allowWrite) out.agent = { allowWrite: true };
  if (s.language !== 'system') out.language = s.language;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** What the dialog shows and the bridge binds: the stored numbers over the defaults. */
export function effectiveRange(s: Settings): PortRange {
  return parsePortRange(s.port, s.portCount);
}

/** A value equal to the default is stored as "not set", so a later default change is followed. */
export function withPort(s: Settings, raw: number): Settings {
  const port = validPort(Math.round(raw));
  if (port === null) return s;
  const count = s.portCount;
  const next = settled(port === DEFAULT_PORT ? null : port, count);
  // The range would run past 65535: shrink the count instead of refusing the port.
  if (next.portCount === null && count !== null) {
    const room = MAX_PORT + 1 - port;
    return { ...s, port: next.port, portCount: room === DEFAULT_PORT_COUNT ? null : room };
  }
  if (next.portCount === null && port + DEFAULT_PORT_COUNT - 1 > MAX_PORT)
    return { ...s, port: next.port, portCount: MAX_PORT + 1 - port };
  return { ...s, ...next };
}

export function withPortCount(s: Settings, raw: number): Settings {
  const room = MAX_PORT + 1 - (s.port ?? DEFAULT_PORT);
  const count = validCount(Math.min(Math.round(raw), room, MAX_PORT_COUNT));
  if (count === null) return s;
  return { ...s, portCount: count === DEFAULT_PORT_COUNT ? null : count };
}

/** `BEIFAHRER_PORT` / `BEIFAHRER_PORT_COUNT` set to something beat the file (ADR 0017 § 8). */
export function overriddenByEnvironment(env: Record<string, string | undefined>): boolean {
  return [env.BEIFAHRER_PORT, env.BEIFAHRER_PORT_COUNT].some((v) => v !== undefined && v.trim() !== '');
}

/** The raw port values for `parsePortRange`: flag, then environment, then the file. Empty means unset. */
export function rawRange(
  flags: { port?: unknown; count?: unknown },
  env: Record<string, string | undefined>,
  s: Settings,
): { port: unknown; count: unknown } {
  const set = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  const pick = (...candidates: unknown[]) => candidates.find(set);
  return {
    port: pick(flags.port, env.BEIFAHRER_PORT, s.port),
    count: pick(flags.count, env.BEIFAHRER_PORT_COUNT, s.portCount),
  };
}

/** Language candidates for `pickLocale`: the override alone, or the system's list. */
export function localeCandidates(language: Language, system: readonly string[]): readonly string[] {
  return language === 'system' ? system : [language];
}
