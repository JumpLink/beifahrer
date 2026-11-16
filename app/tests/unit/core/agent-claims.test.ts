import { describe, expect, it } from '@gjsify/unit';

import type { ClaimVerdict } from '@beifahrer/core';
import { AGENTS, CLAIMS, claimsOf, claimsExitCode, normalizePage, verify } from '@beifahrer/core';

// Fixture strings only: the fetch is in tools/check-agent-catalog.mjs and never runs in a test.
const filler = ' Some prose that keeps the page above the size of a consent wall.'.repeat(5);
const page = (body: string) => ({ status: 200, body: `<html><body>${body}${filler}</body></html>` });

export default async () => {
  await describe('agent claims', async () => {
    await it('has at least one claim for every catalog entry and none for a stranger', async () => {
      for (const a of AGENTS) expect(claimsOf(a).length > 0).toBe(true);
      expect(Object.keys(CLAIMS).sort().join()).toBe(
        AGENTS.map((a) => a.id)
          .sort()
          .join(),
      );
      let threw = false;
      try {
        claimsOf({ id: 'nope' });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('normalises tags, entities and escaped quotes', async () => {
      expect(normalizePage('<span>&quot;mcp</span><span>Servers&quot;</span>')).toBe('"mcpServers"');
      expect(normalizePage('{\\"type\\": \\"local\\"}')).toBe('{"type": "local"}');
      expect(normalizePage('a\n\n  b<script>var x = "mcpServers"</script>')).toBe('a b ');
      expect(normalizePage('&#60;x&#x3e; &amp;')).toBe('<x> &');
    });

    await it('is ok when every claim still shows, through highlighter spans', async () => {
      const body =
        '<code><span>"mcpServers"</span><span>: {</span></code><span>"type": "stdio"</span> mcp-config.json .mcp.json';
      const v = verify(claimsOf({ id: 'vscode' }), page(body));
      expect(v.status).toBe('ok');
    });

    await it('is drifted and names what is missing', async () => {
      const v = verify(claimsOf({ id: 'vscode' }), page('A guided flow. Share the file as .mcp.json'));
      expect(v.status).toBe('drifted');
      if (v.status === 'drifted') {
        expect(v.missing.length).toBe(3);
        expect(v.missing[0]).toMatch(/mcpServers/);
      }
    });

    await it('matches a codex TOML table literally, through entities', async () => {
      expect(verify(claimsOf({ id: 'codex' }), page('use a [mcp_servers.&lt;name&gt;] table')).status).toBe(
        'ok',
      );
      expect(verify(claimsOf({ id: 'codex' }), page('use a [mcp-servers.name] table')).status).toBe(
        'drifted',
      );
    });

    await it('treats a failed, empty or non-2xx fetch as unverified, never as ok', async () => {
      const claims = claimsOf({ id: 'cursor' });
      expect(verify(claims, { status: 0, body: '', error: 'TimeoutError' }).status).toBe('unverified');
      expect(verify(claims, { status: 404, body: 'mcpServers' + filler }).status).toBe('unverified');
      expect(verify(claims, { status: 503, body: '' }).status).toBe('unverified');
      expect(verify(claims, { status: 200, body: 'mcpServers' }).status).toBe('unverified');
    });

    await it('exits 1 on drift, 2 on unverified alone, 0 only when all verified', async () => {
      const ok: ClaimVerdict = { status: 'ok', checked: 1 };
      const drifted: ClaimVerdict = { status: 'drifted', missing: ['x'] };
      const unverified: ClaimVerdict = { status: 'unverified', reason: 'r' };
      expect(claimsExitCode([ok, ok])).toBe(0);
      expect(claimsExitCode([ok, unverified])).toBe(2);
      expect(claimsExitCode([unverified, drifted, ok])).toBe(1);
    });
  });
};
