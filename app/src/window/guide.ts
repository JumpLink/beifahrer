/**
 * The words for an app that is set up in its own settings screens instead of by a file (ADR 0023):
 * where to click, then the command and arguments to type, or the JSON to paste. Pure, like the other
 * models; the setup page and the "Connect an agent" page both show it, so they say the same thing.
 *
 * The command and arguments come from `serverSpec`, so a Flatpak install shows the `flatpak run` form.
 */

import { shellQuote, type AgentEntry, type Install, type ServerSpec } from '@beifahrer/core';

import type { Key, Translate } from './i18n.ts';

const WHERE: Record<string, Key> = {
  jan: 'guide.where.jan',
  goose: 'guide.where.goose',
  'cherry-studio': 'guide.where.cherry-studio',
  jetbrains: 'guide.where.jetbrains',
  other: 'guide.where.other',
};

/** The name a person reads: the catalog's own name, except for the entry that stands for "any other app". */
export function agentLabel(agent: AgentEntry, t: Translate): string {
  return agent.id === 'other' ? t('setup.group.other') : agent.name;
}

/** The steps for `agent`, or an empty list when it is set up through a file. */
export function guideSteps(agent: AgentEntry, server: ServerSpec, install: Install, t: Translate): string[] {
  if (agent.guide === null) return [];
  const command = server.command;
  const args = server.args.map((w) => shellQuote(w, server.platform)).join(' ');
  const where = t(WHERE[agent.id] ?? 'guide.where.other');
  const steps: string[] = [where];
  if (agent.id === 'other') {
    steps.push(t('guide.fields.command', { command }), t('guide.fields.args', { args }), t('guide.json'));
  } else if (agent.guide === 'fields') {
    steps.push(
      t('guide.fields.kind'),
      t('guide.fields.name'),
      t('guide.fields.command', { command }),
      t('guide.fields.args', { args }),
      t('guide.fields.save'),
    );
  } else {
    steps.push(t('guide.json.paste'));
  }
  if (agent.id === 'other') steps.push(t('guide.sandbox'));
  else if (install.flatpak) steps.push(t('guide.flatpak'));
  return steps;
}
