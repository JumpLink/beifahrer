/**
 * What a bridge tells anything that wants to look (ADR 0015): one small entry per live session, and
 * the ladder a reader walks over them. Pure: no files, no clock, no timers. The caller passes the
 * time in, and the files themselves are app/src/registry/.
 *
 * The entry carries what the bridge KNOWS and nothing the agent could not already be told: no token,
 * no URL, no tab, no argument. It cannot say "paused" or "all sites" because the bridge is never told
 * either (ADR 0015 §5); the extension's own ladder (`alarmOf`) is the only place that knows.
 */

import type { BridgeStatus, BrowserFamily } from './protocol.ts';

export const REGISTRY_VERSION = 1;
/** How often a live bridge rewrites its entry, even when nothing changed. */
export const HEARTBEAT_MS = 5_000;
/** An entry not refreshed for this long (three beats) is a bridge that is gone. */
export const STALE_MS = 3 * HEARTBEAT_MS;

export interface RegistryBrowser {
  /** The connection id, as `browsers_list` shows it. */
  id: string;
  family: BrowserFamily;
  name: string;
  version: string;
  extensionVersion: string;
  /** ISO 8601. */
  connectedAt: string;
}

export interface RegistryEntry {
  v: typeof REGISTRY_VERSION;
  instance: string;
  /** "claude-code · werkstatt". May name a private project: never leaves the machine. */
  label: string;
  /** Informational only: a reader in another PID namespace cannot test it. */
  pid: number;
  port: number;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601, refreshed at least every `HEARTBEAT_MS`; liveness is this, not the pid. */
  updatedAt: string;
  bridgeVersion: string;
  browsers: RegistryBrowser[];
}

/** The entry for a bridge as it is now. */
export function entryOf(status: BridgeStatus, now: Date): RegistryEntry {
  const { session } = status;
  return {
    v: REGISTRY_VERSION,
    instance: session.instance,
    label: session.label,
    pid: session.pid,
    port: status.port,
    startedAt: session.startedAt,
    updatedAt: now.toISOString(),
    bridgeVersion: status.version,
    browsers: status.browsers.map((b) => ({
      id: b.id,
      family: b.browser.family,
      name: b.browser.name,
      version: b.browser.version,
      extensionVersion: b.extension.version,
      connectedAt: b.connectedAt,
    })),
  };
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
/** A string that is a date: a reader sorts and subtracts it, so one that is not is no entry. */
const isDate = (x: unknown): x is string => isString(x) && Number.isFinite(Date.parse(x));

function parseBrowser(raw: unknown): RegistryBrowser | null {
  const b = raw as Partial<RegistryBrowser> | null;
  if (!b || typeof b !== 'object') return null;
  if (!isString(b.id) || !isString(b.family) || !isString(b.name) || !isString(b.version)) return null;
  if (!isString(b.extensionVersion) || !isDate(b.connectedAt)) return null;
  return {
    id: b.id,
    family: b.family as BrowserFamily,
    name: b.name,
    version: b.version,
    extensionVersion: b.extensionVersion,
    connectedAt: b.connectedAt,
  };
}

/**
 * Validate an entry read from disk. Returns a reason on failure. Fail-closed like `parsePolicy`: an
 * entry that does not parse, or has another `v`, is dropped whole, never repaired. Only the known
 * fields are copied, so a file that carries more says nothing more.
 */
export function parseRegistryEntry(raw: unknown): RegistryEntry | string {
  const e = raw as Partial<RegistryEntry> | null;
  if (!e || typeof e !== 'object') return 'not an object';
  if (e.v !== REGISTRY_VERSION) return `unsupported registry version ${String(e.v)}`;
  if (!isString(e.instance) || !e.instance) return 'no instance';
  if (!isString(e.label) || !isString(e.bridgeVersion)) return 'no label or bridge version';
  if (!isCount(e.pid) || !isCount(e.port)) return 'pid and port must be whole numbers';
  if (!isDate(e.startedAt) || !isDate(e.updatedAt)) return 'startedAt and updatedAt must be dates';
  if (!Array.isArray(e.browsers)) return 'no browsers list';
  const browsers: RegistryBrowser[] = [];
  for (const raw of e.browsers) {
    const b = parseBrowser(raw);
    if (!b) return 'a browser entry is malformed';
    browsers.push(b);
  }
  return {
    v: REGISTRY_VERSION,
    instance: e.instance,
    label: e.label,
    pid: e.pid,
    port: e.port,
    startedAt: e.startedAt,
    updatedAt: e.updatedAt,
    bridgeVersion: e.bridgeVersion,
    browsers,
  };
}

/** Alive while its last heartbeat is recent. A date in the future (a clock that moved back) is alive. */
export function isAlive(entry: Pick<RegistryEntry, 'updatedAt'>, now: Date): boolean {
  return now.getTime() - Date.parse(entry.updatedAt) <= STALE_MS;
}

/**
 * What a reader can tell the person, loudest first (ADR 0015 §5):
 *
 *   no-bridge    no live entry: no agent session is running, so no agent can use the browser
 *   no-browser   live bridges, none with a browser: not paired, not running or dismissed
 *   ready        a live bridge with a browser
 *
 * The first two are alarms in the sense of ADR 0014: the reader shows the next step, not an empty
 * list. A pause is NOT a rung here; the bridge is never told (ADR 0015 §5).
 */
export type Presence = 'no-bridge' | 'no-browser' | 'ready';

export interface RegistryStatus {
  presence: Presence;
  /** Live sessions, oldest first. */
  sessions: RegistryEntry[];
}

export function statusOf(entries: readonly RegistryEntry[], now: Date): RegistryStatus {
  const sessions = entries
    .filter((e) => isAlive(e, now))
    .sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.instance.localeCompare(b.instance),
    );
  const presence: Presence =
    sessions.length === 0
      ? 'no-bridge'
      : sessions.some((s) => s.browsers.length > 0)
        ? 'ready'
        : 'no-browser';
  return { presence, sessions };
}

/** Entries that have been dead for more than `graceMs`: what a starting bridge may sweep. */
export function sweepable(entries: readonly RegistryEntry[], now: Date, graceMs = 60_000): RegistryEntry[] {
  return entries.filter((e) => now.getTime() - Date.parse(e.updatedAt) > STALE_MS + graceMs);
}
