/**
 * Where a session's bridge listens and what the person sees it called (ADR 0007). Shared by every
 * command that starts a bridge: `mcp`, `tool`, `call`, `serve`.
 */

import {
  DEFAULT_PORT,
  DEFAULT_PORT_COUNT,
  MAX_PORT_COUNT,
  cleanSessionLabel,
  defaultSessionLabel,
  parsePortRange,
  type PortRange,
} from '@beifahrer/core';

export interface RangeArgs {
  port?: number;
  'port-count'?: number;
}

/** The yargs options for the range, the same on every command. */
export const rangeOptions = {
  port: {
    type: 'number',
    describe: `First port of the loopback range (default ${DEFAULT_PORT}, or $BEIFAHRER_PORT)`,
  },
  'port-count': {
    type: 'number',
    describe: `Ports in the range, 1–${MAX_PORT_COUNT} (default ${DEFAULT_PORT_COUNT}, or $BEIFAHRER_PORT_COUNT). The extension options must say the same.`,
  },
} as const;

export function rangeOf(argv: RangeArgs): PortRange {
  return parsePortRange(
    argv.port ?? process.env.BEIFAHRER_PORT,
    argv['port-count'] ?? process.env.BEIFAHRER_PORT_COUNT,
  );
}

/** `BEIFAHRER_SESSION_LABEL`, if the person set one that has something printable in it. */
export function labelOverride(): string | null {
  return cleanSessionLabel(process.env.BEIFAHRER_SESSION_LABEL);
}

/** The label for a session run by `client` (an MCP client's name, or the command). */
export function sessionLabel(client: string): string {
  return labelOverride() ?? defaultSessionLabel(client, process.cwd());
}
