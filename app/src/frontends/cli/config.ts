/**
 * `beifahrer config [agent]`: the snippet that registers Beifahrer with a coding agent, and the file
 * it goes in. Prints and writes nothing else: the person pastes it (ADR 0017). The table is the same
 * one the desktop window's "Connect an agent" page shows (`AGENTS` in core).
 */

import type { CommandModule } from 'yargs';
import {
  AGENTS,
  CHECKED,
  findAgent,
  serverSpec,
  snippetOf,
  userConfigPath,
  type AgentEntry,
} from '@beifahrer/core';

export function renderAgentList(): string {
  return [
    'Pass one of these to get its snippet:',
    ...AGENTS.map((a) => `  ${a.id.padEnd(15)}${a.name}`),
  ].join('\n');
}

export function renderConfig(agent: AgentEntry, allowWrite: boolean, platform: string): string {
  const server = serverSpec({ allowWrite });
  const user = userConfigPath(agent, platform);
  const lines = [
    `${agent.name}: add this to ${user ?? 'its config (the docs name no fixed file here)'}` +
      (agent.project ? `, or to ${agent.project} in a project` : ''),
    '',
    snippetOf(agent, server),
  ];
  if (agent.cli) lines.push('', `Or in one command: ${agent.cli(server)}`);
  lines.push('', `Format as of ${CHECKED}; if it no longer works, see ${agent.docs}`);
  return lines.join('\n');
}

export const configCommand: CommandModule<object, { agent?: string; 'allow-write'?: boolean }> = {
  command: 'config [agent]',
  describe: 'Print the snippet that registers Beifahrer with a coding agent',
  builder: (y) =>
    y
      .positional('agent', { type: 'string', describe: 'claude-code, opencode, codex, … (none: list them)' })
      .option('allow-write', {
        type: 'boolean',
        describe: 'Include --allow-write, which exposes page_fill / page_click / tab_open',
      }),
  handler: (argv) => {
    const agent = argv.agent ? findAgent(argv.agent) : undefined;
    if (argv.agent && !agent) {
      console.error(`Unknown agent "${argv.agent}".\n${renderAgentList()}`);
      process.exit(1);
    }
    console.log(
      agent ? renderConfig(agent, argv['allow-write'] === true, process.platform) : renderAgentList(),
    );
    process.exit(0);
  },
};
