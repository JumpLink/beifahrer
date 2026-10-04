import { describe, expect, it } from '@gjsify/unit';
import { findAgent } from '@beifahrer/core';

import { renderAgentList, renderConfig } from '../../../src/frontends/cli/config.ts';

export default async () => {
  await describe('beifahrer config', async () => {
    await it('lists every agent id when none is named', async () => {
      const text = renderAgentList();
      expect(text).toMatch(/claude-code {2,}Claude Code/);
      expect(text).toMatch(/zed {2,}Zed/);
    });

    await it('says where the snippet goes, prints it, and links the docs', async () => {
      const text = renderConfig(findAgent('claude-code')!, true, 'darwin');
      expect(text).toMatch(/add this to ~\/\.claude\.json, or to \.mcp\.json in a project/);
      expect(text).toMatch(/"command": "beifahrer"/);
      expect(text).toMatch(/Or in one command: claude mcp add/);
      expect(text).toMatch(/https:\/\/code\.claude\.com\/docs\/en\/mcp/);
    });

    await it('says so when the docs name no file for this platform', async () => {
      expect(renderConfig(findAgent('claude-desktop')!, false, 'linux')).toMatch(
        /the docs name no fixed file here/,
      );
    });
  });
};
