/**
 * `beifahrer status`: which agent sessions are running and which browsers hang on them, read from the
 * registry (ADR 0015). It starts no bridge and binds no port, so it can run beside any agent.
 *
 * It says what the BRIDGES know. Whether the person paused beifahrer in the browser is not among it
 * (ADR 0015 §5): look at the toolbar button for that.
 */

import type { CommandModule } from 'yargs';
import { statusOf, type Presence, type RegistryEntry, type RegistryStatus } from '@beifahrer/core';
import { readEntries, registryDir } from '@beifahrer/local';

export interface StatusReport extends RegistryStatus {
  /** Files in the registry that were not entries. Present so a silent drop is at least countable. */
  skipped: number;
}

export function reportOf(entries: readonly RegistryEntry[], skipped: number, now: Date): StatusReport {
  return { ...statusOf(entries, now), skipped };
}

/** The headline per rung: the state, and for the two alarms the one next step (ADR 0014). */
const HEADLINE: Record<Presence, (n: number) => string> = {
  'no-bridge': () =>
    'No agent session is running, so no agent can use a browser. Start an agent that has beifahrer.',
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
  return lines.join('\n');
}

export const statusCommand: CommandModule<object, { json?: boolean }> = {
  command: 'status',
  describe: 'Show the running agent sessions and the browsers connected to them',
  builder: (y) => y.option('json', { type: 'boolean', describe: 'Print the machine-readable form' }),
  handler: (argv) => {
    const { entries, skipped } = readEntries(registryDir());
    const report = reportOf(
      entries.map((e) => e.entry),
      skipped,
      new Date(),
    );
    console.log(argv.json ? JSON.stringify(report, null, 2) : renderStatus(report));
    // Exit explicitly, like every command that is not `mcp` (see `finish` in commands.ts).
    process.exit(0);
  },
};
