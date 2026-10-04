import { describe, expect, it } from '@gjsify/unit';
import { findAgent } from '@beifahrer/core';

import { agentView } from '../../src/agents-model.ts';
import { createTranslate } from '../../src/i18n.ts';

const t = createTranslate('en');
const view = (id: string, allowWrite: boolean, platform = 'darwin', translate = t) =>
  agentView(findAgent(id)!, allowWrite, platform, translate);

export default async () => {
  await describe('agent view', async () => {
    await it('carries the snippet, the file it goes in and the docs', async () => {
      const v = view('claude-code', true);
      expect(v.snippet).toMatch(/"args": \[\s+"mcp",\s+"--allow-write"\s+\]/);
      expect(v.userFile).toBe('~/.claude.json');
      expect(v.projectFile).toBe('.mcp.json');
      expect(v.command).toBe('claude mcp add --transport stdio beifahrer -- beifahrer mcp --allow-write');
      expect(v.docs).toBe('https://code.claude.com/docs/en/mcp');
    });

    await it('follows the switch: no --allow-write unless it is on', async () => {
      expect(view('codex', false).snippet).not.toMatch(/allow-write/);
      expect(view('codex', true).snippet).toMatch(/allow-write/);
    });

    await it('says the docs name no file, instead of a path that may be wrong', async () => {
      expect(view('claude-desktop', false, 'linux').userFile).toBe(
        "No fixed file: see the agent's documentation",
      );
      expect(view('claude-desktop', false, 'linux', createTranslate('de')).userFile).toBe(
        'Keine feste Datei: siehe die Dokumentation des Agenten',
      );
    });

    await it('has no command or project file where the agent has none, and says when it was checked', async () => {
      const v = view('zed', false);
      expect(v.command).toBe(null);
      expect(v.projectFile).toBe(null);
      expect(v.checked).toMatch(/^Checked against the agent's documentation on 20\d\d-\d\d-\d\d\./);
    });
  });
};
