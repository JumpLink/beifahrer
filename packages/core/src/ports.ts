/**
 * The loopback port range agent sessions bind and the extension probes (ADR 0007).
 *
 * Every agent session's bridge binds the first free port of the range; the extension connects to
 * every port of it that answers. Both sides read the same two numbers, the first port and how
 * many, and fall back to the defaults field by field, so a malformed setting never widens the
 * range beyond what the person could type.
 */

/** First port of the range. Both sides let the person override it. */
export const DEFAULT_PORT = 47813;
/** Ports in the range: how many agent sessions can reach the browser at once. */
export const DEFAULT_PORT_COUNT = 10;
/** Every port is probed every few seconds; more than this is a mistake, not a use case. */
export const MAX_PORT_COUNT = 64;

export interface PortRange {
  base: number;
  count: number;
}

export const DEFAULT_PORT_RANGE: PortRange = { base: DEFAULT_PORT, count: DEFAULT_PORT_COUNT };

function asInteger(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : null;
}

/** Read a range from settings, flags or the environment. Each field falls back on its own. */
export function parsePortRange(rawBase: unknown, rawCount: unknown): PortRange {
  const b = asInteger(rawBase);
  const base = b !== null && b >= 1024 && b <= 65535 ? b : DEFAULT_PORT;
  const c = asInteger(rawCount);
  const count = c !== null && c >= 1 && c <= MAX_PORT_COUNT ? c : DEFAULT_PORT_COUNT;
  // The range must end at 65535 at the latest.
  return { base, count: Math.min(count, 65536 - base) };
}

export function portsOf(range: PortRange): number[] {
  return Array.from({ length: range.count }, (_, i) => range.base + i);
}

export function describeRange(range: PortRange): string {
  return range.count === 1 ? String(range.base) : `${range.base}–${range.base + range.count - 1}`;
}

export class PortRangeFull extends Error {
  constructor(
    readonly range: PortRange,
    readonly errors: { port: number; error: unknown }[],
  ) {
    const last = errors.at(-1)?.error;
    super(
      `every port of 127.0.0.1:${describeRange(range)} is taken — ${range.count} agent sessions (or other ` +
        'programs) hold them already. End a session you no longer need, or widen the range: ' +
        'BEIFAHRER_PORT_COUNT for the bridge and "Ports" in the extension options, the same number on both ' +
        `sides.${last instanceof Error ? ` Last error: ${last.message}` : ''}`,
    );
  }
}

/**
 * Bind the first free port of the range, in order. `tryBind` resolves once it listens, or
 * rejects; ANY rejection moves on to the next port. On GJS "taken" is only recognisable from a
 * localised message, and a port that fails for another reason is no better to stay on.
 */
export async function bindFirstFree<T>(
  range: PortRange,
  tryBind: (port: number) => Promise<T>,
): Promise<{ port: number; value: T }> {
  const errors: { port: number; error: unknown }[] = [];
  for (const port of portsOf(range)) {
    try {
      return { port, value: await tryBind(port) };
    } catch (error) {
      errors.push({ port, error });
    }
  }
  throw new PortRangeFull(range, errors);
}
