/**
 * `beifahrer status`: which agent sessions are running and which browsers hang on them, read from the
 * registry (ADR 0015). It starts no bridge and binds no port, so it can run beside any agent.
 *
 * It says what the BRIDGES know, plus which ports of the range answer a connect without a bridge
 * having announced them (a TCP probe, nothing is sent). Whether the person paused Beifahrer in the
 * browser is not among it (ADR 0015 §5): look at the toolbar button for that.
 */

import type { CommandModule } from 'yargs';
import {
  portsOf,
  statusOf,
  unregisteredPorts,
  type Presence,
  type RegistryEntry,
  type RegistryStatus,
} from '@beifahrer/core';
import { probePorts, readEntries, registryDir } from '@beifahrer/local';

import { rangeOf, rangeOptions, type RangeArgs } from '../../bridge/session.ts';

export interface StatusReport extends RegistryStatus {
  /** Files in the registry that were not entries. Present so a silent drop is at least countable. */
  skipped: number;
  /** Ports of the range where something listens that no live session announced (older Beifahrer, a hung bridge, another program). */
  unregistered: number[];
}

export function reportOf(
  entries: readonly RegistryEntry[],
  skipped: number,
  now: Date,
  listening: readonly number[] = [],
): StatusReport {
  const status = statusOf(entries, now);
  return { ...status, skipped, unregistered: unregisteredPorts(listening, status.sessions) };
}

/** The headline per rung: the state, and for the two alarms the one next step (ADR 0014). */
const HEADLINE: Record<Presence, (n: number) => string> = {
  'no-bridge': () =>
    'No agent session is running, so no agent can use a browser. Start an agent that has Beifahrer.',
  'no-browser': (n) =>
    `${n} agent session${n === 1 ? ' is' : 's are'} running, but no browser is connected to ${n === 1 ? 'it' : 'any'}. ` +
    'Open the browser with the extension, or check the pairing token (`beifahrer token`).',
  ready: (n) => `${n} agent session${n === 1 ? '' : 's'} running, a browser is connected.`,
};

export function renderStatus(report: StatusReport): string {
  const lines = [HEADLINE[report.presence](report.sessions.length)];
  for (const s of report.sessions) {
    lines.push('', `${s.label}  (port ${s.port}, since ${s.startedAt})`);
    if (s.browsers.length === 0) lines.push('  no browser');
    for (const b of s.browsers)
      lines.push(`  ${b.name} ${b.version}  extension ${b.extensionVersion}  (${b.id})`);
  }
  if (report.skipped > 0)
    lines.push(
      '',
      `${report.skipped} file${report.skipped === 1 ? '' : 's'} in the registry could not be read.`,
    );
  if (report.unregistered.length > 0) {
    const ports = report.unregistered.join(', ');
    lines.push(
      '',
      `${report.unregistered.length === 1 ? `Port ${ports} is` : `Ports ${ports} are`} held by something that no ` +
        'running Beifahrer session announced: an older Beifahrer, a bridge that no longer answers, or another ' +
        'program. A browser tries it like any other port. If it is a Beifahrer, restart the agent session that ' +
        'started it.',
    );
  }
  return lines.join('\n');
}

export const statusCommand: CommandModule<object, { json?: boolean } & RangeArgs> = {
  command: 'status',
  describe: 'Show the running agent sessions and the browsers connected to them',
  builder: (y) =>
    y.options(rangeOptions).option('json', { type: 'boolean', describe: 'Print the machine-readable form' }),
  handler: async (argv) => {
    const { entries, skipped } = readEntries(registryDir());
    const listening = await probePorts(portsOf(rangeOf(argv)));
    const report = reportOf(
      entries.map((e) => e.entry),
      skipped,
      new Date(),
      listening,
    );
    console.log(argv.json ? JSON.stringify(report, null, 2) : renderStatus(report));
    // Exit explicitly, like every command that is not `mcp` (see `finish` in commands.ts).
    process.exit(0);
  },
};
