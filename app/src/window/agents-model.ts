/**
 * What the "Connect an agent" page shows for one agent and one choice of `--allow-write`: the
 * snippet, where it goes, the one-line command if there is one, the docs link. Pure, like the other
 * models. The table is `AGENTS` in core, the same one `beifahrer config` prints.
 *
 * This page writes into no agent's config; it shows text to copy (ADR 0017). The setup assistant is what writes.
 */

import {
  CHECKED,
  serverSpec,
  snippetOf,
  userConfigPath,
  type AgentEntry,
  type Install,
} from '@beifahrer/core';

import type { Translate } from './i18n.ts';

export interface AgentView {
  snippet: string;
  /** The user-level file, or a line saying the docs name none for this platform. */
  userFile: string;
  /** Null when the agent has no per-project file. */
  projectFile: string | null;
  /** Null when the agent has no non-interactive add command. */
  command: string | null;
  docs: string;
  checked: string;
  /** Set when the bridge was looked for on this OS and not found: the command is then a placeholder. */
  hint: string | null;
}

export function agentView(
  agent: AgentEntry,
  allowWrite: boolean,
  platform: string,
  t: Translate,
  install: Install = { platform },
): AgentView {
  const server = serverSpec({ allowWrite, install });
  return {
    snippet: snippetOf(agent, server),
    userFile: userConfigPath(agent, platform) ?? t('agents.nofile'),
    projectFile: agent.project,
    command: agent.cli ? agent.cli(server) : null,
    docs: agent.docs,
    checked: t('agents.checked', { date: CHECKED }),
    hint: install.launcher === null && !install.flatpak ? t('agents.nobridge') : null,
  };
}
