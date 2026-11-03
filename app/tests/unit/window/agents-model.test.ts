import { describe, expect, it } from '@gjsify/unit';
import { findAgent } from '@beifahrer/core';

import { agentChoices, agentView } from '../../../src/window/agents-model.ts';
import { createTranslate } from '../../../src/window/i18n.ts';

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
    await it('uses the installed launcher, and hints when the bridge was looked for and not found', async () => {
      const launcher = '/Applications/Beifahrer.app/Contents/MacOS/beifahrer';
      const found = agentView(findAgent('cursor')!, false, 'darwin', t, { platform: 'darwin', launcher });
      expect(found.snippet).toMatch(/Beifahrer\.app\/Contents\/MacOS\/beifahrer/);
      expect(found.hint).toBe(null);
      const missing = agentView(findAgent('cursor')!, false, 'darwin', t, {
        platform: 'darwin',
        launcher: null,
      });
      expect(missing.hint).toMatch(/not found/);
      expect(missing.snippet).toMatch(/"command": "beifahrer"/);
      const flatpak = agentView(findAgent('cursor')!, false, 'linux', t, {
        platform: 'linux',
        flatpak: true,
      });
      expect(flatpak.hint).toBe(null);
      expect(flatpak.snippet).toMatch(/"flatpak"/);
    });
  });

  await describe('agent choices and guides', async () => {
    await it('orders the drop-down by group and leaves out what the system cannot use', async () => {
      const linux = agentChoices('linux').map((a) => a.id);
      expect(linux[0]).toBe('lm-studio');
      expect(linux.includes('claude-desktop')).toBe(false);
      expect(linux[linux.length - 1]).toBe('other');
      expect(
        agentChoices('win32')
          .map((a) => a.id)
          .includes('claude-desktop'),
      ).toBe(true);
    });

    await it('shows steps with the command and arguments for an app set up in its own screens', async () => {
      const v = view('jan', false, 'linux');
      expect(v.steps.length).toBeGreaterThan(3);
      expect(v.steps.join('\n')).toContain('beifahrer');
      expect(v.steps.join('\n')).toContain('mcp');
      expect(v.userFile).toBe('');
    });

    await it('tells the Other entry about flatpak-spawn and shows the Flatpak command', async () => {
      const v = agentView(findAgent('other')!, false, 'linux', t, { platform: 'linux', flatpak: true });
      const text = v.steps.join('\n');
      expect(text).toContain('flatpak-spawn --host');
      expect(text).toContain('flatpak');
      expect(text).toContain('outside its sandbox');
      expect(text).toContain('eu.jumplink.beifahrer');
      expect(v.snippet).toMatch(/"flatpak"/);
    });

    await it('has no steps for an agent set up through a file', async () => {
      expect(view('cursor', false, 'linux').steps.length).toBe(0);
    });
  });
};
