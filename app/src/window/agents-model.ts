/**
 * What the "Connect an agent" page shows for one agent and one choice of `--allow-write`: the
 * snippet, where it goes, the one-line command if there is one, the docs link. Pure, like the other
 * models. The table is `AGENTS` in core, the same one `beifahrer config` prints.
 *
 * This page writes into no agent's config; it shows text to copy (ADR 0017). The setup assistant is what writes.
 */

import {
  AGENTS,
  CHECKED,
  agentSections,
  serverSpec,
  snippetOf,
  userConfigPath,
  type AgentEntry,
  type Install,
} from '@beifahrer/core';

import { guideSteps } from './guide.ts';
import type { Translate } from './i18n.ts';

/** The page's drop-down: AI apps, coding agents, other, only what `platform` can use. */
export function agentChoices(platform: string): AgentEntry[] {
  const all = agentSections(platform).flatMap((s) => s.agents);
  return all.length > 0 ? all : [...AGENTS];
}

export interface AgentView {
  /** Steps in the app's own screens, empty for an agent set up through a file. */
  steps: string[];
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
    steps: guideSteps(agent, server, install, t),
    snippet: snippetOf(agent, server),
    userFile: userConfigPath(agent, platform) ?? (agent.guide ? '' : t('agents.nofile')),
    projectFile: agent.project,
    command: agent.cli ? agent.cli(server) : null,
    docs: agent.docs,
    checked: t('agents.checked', { date: CHECKED }),
    hint: install.launcher === null && !install.flatpak ? t('agents.nobridge') : null,
  };
}
