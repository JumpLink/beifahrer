/**
 * `beifahrer doctor`: the checks of `diagnose` (core) over what this machine says right now. It
 * changes nothing: no token is created, no bridge started, nothing sent but a TCP connect to each
 * port of the range.
 */

import type { CommandModule } from 'yargs';
import { diagnose, exitCodeOf, portsOf, statusOf, type Check, type CheckLevel } from '@beifahrer/core';
import { inspectToken, probePorts, readEntries, registryDir } from '@beifahrer/local';

import { rangeOf, rangeOptions, type RangeArgs } from '../../bridge/session.ts';
import { VERSION } from '../../version.ts';

const MARK: Record<CheckLevel, string> = { ok: '✔', warn: '!', fail: '✖' };

export function renderChecks(checks: readonly Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${MARK[c.level]} ${c.title}`);
    if (c.fix) lines.push(`    ${c.fix}`);
  }
  return lines.join('\n');
}

/**
 * The runtime the bundle runs on. Not `process.versions`: under GJS that is gjsify's Node shim and
 * says "Node 20", which is true of the API and false of the engine. GJS's own version is a number,
 * major * 10000 + minor * 100 + micro.
 */
type GjsGlobal = { imports?: { system?: { version?: number } } };

export function runtimeName(g: GjsGlobal = globalThis as GjsGlobal): string {
  const gjs = g.imports?.system?.version;
  if (typeof gjs === 'number') {
    return `GJS ${Math.floor(gjs / 10000)}.${Math.floor(gjs / 100) % 100}.${gjs % 100}`;
  }
  return `Node.js ${process.versions.node}`;
}

export const doctorCommand: CommandModule<object, { json?: boolean } & RangeArgs> = {
  command: 'doctor',
  describe: 'Check what stands between an agent and your browser, and say what to do about it',
  builder: (y) =>
    y.options(rangeOptions).option('json', { type: 'boolean', describe: 'Print the machine-readable form' }),
  handler: async (argv) => {
    const range = rangeOf(argv);
    const { entries, skipped } = readEntries(registryDir());
    const checks = diagnose({
      version: VERSION,
      runtime: runtimeName(),
      range,
      listening: await probePorts(portsOf(range)),
      status: statusOf(
        entries.map((e) => e.entry),
        new Date(),
      ),
      skipped,
      token: inspectToken(),
    });
    console.log(argv.json ? JSON.stringify(checks, null, 2) : renderChecks(checks));
    // Exit explicitly, like every command that is not `mcp` (see `finish` in commands.ts).
    process.exit(exitCodeOf(checks));
  },
};
