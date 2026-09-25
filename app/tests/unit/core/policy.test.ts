import { describe, expect, it } from '@gjsify/unit';

import {
  EMPTY_POLICY,
  decide,
  levelFor,
  originOf,
  parsePolicy,
  withRule,
  type Policy,
} from '@beifahrer/core';

// The policy is the product's safety claim. Every case below is a way it could fail OPEN.
export default async () => {
  const policy: Policy = {
    origins: {
      'https://tracker.example': { level: 'write' },
      'https://quiet.example': { level: 'write', confirmWrites: false },
      'https://bank.example': { level: 'read' },
    },
  };

  await describe('originOf', async () => {
    await it('keeps scheme, host and non-default port, drops path and query', async () => {
      expect(originOf('https://tracker.example/projects/1?x=2#y')).toBe('https://tracker.example');
      expect(originOf('http://localhost:3000/a')).toBe('http://localhost:3000');
    });
    await it('gives browser-internal, local and extension pages no origin', async () => {
      for (const url of [
        'about:blank',
        'chrome://settings',
        'file:///etc/passwd',
        'moz-extension://abc/x.html',
        'data:text/html,hi',
        '',
      ]) {
        expect(originOf(url)).toBeNull();
      }
      expect(originOf(undefined)).toBeNull();
      expect(originOf('not a url')).toBeNull();
    });
  });

  await describe('levelFor', async () => {
    await it('is none for an origin nobody configured', async () => {
      expect(levelFor(policy, 'https://elsewhere.example/')).toBe('none');
    });
    await it('does not leak a level to a sibling subdomain or another port', async () => {
      expect(levelFor(policy, 'https://evil.tracker.example/')).toBe('none');
      expect(levelFor(policy, 'https://tracker.example:8443/')).toBe('none');
      expect(levelFor(policy, 'http://tracker.example/')).toBe('none');
    });
  });

  await describe('decide', async () => {
    await it('lets listing tabs through without a level', async () => {
      expect(decide(EMPTY_POLICY, 'tabs.list', undefined)).toStrictEqual({ allow: true, confirm: false });
    });
    await it('refuses a read below read, naming what is missing', async () => {
      expect(decide(policy, 'page.read', 'https://elsewhere.example/x')).toStrictEqual({
        allow: false,
        origin: 'https://elsewhere.example',
        have: 'none',
        need: 'read',
      });
    });
    await it('refuses a write on a read-only site', async () => {
      const d = decide(policy, 'page.fill', 'https://bank.example/inbox');
      expect(d.allow).toBe(false);
    });
    await it('asks before a write unless the site switched it off', async () => {
      expect(decide(policy, 'page.fill', 'https://tracker.example/wp/1')).toStrictEqual({
        allow: true,
        confirm: true,
      });
      expect(decide(policy, 'page.click', 'https://quiet.example/')).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('never confirms a read', async () => {
      expect(decide(policy, 'page.read', 'https://tracker.example/')).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('needs read on the TARGET to open a URL', async () => {
      expect(decide(policy, 'tabs.open', 'https://attacker.example/?q=secret').allow).toBe(false);
      expect(decide(policy, 'tabs.open', 'https://bank.example/').allow).toBe(true);
    });
    await it('refuses page methods on a non-web page even with a policy for it', async () => {
      expect(decide(policy, 'page.read', 'file:///home/me/notes.txt').allow).toBe(false);
    });
  });

  await describe('withRule', async () => {
    await it('removes the entry when set to none, so the default applies', async () => {
      const next = withRule(policy, 'https://bank.example', { level: 'none' });
      expect(Object.keys(next.origins).includes('https://bank.example')).toBe(false);
      expect(Object.keys(policy.origins).includes('https://bank.example')).toBe(true);
    });
  });

  await describe('parsePolicy', async () => {
    await it('drops malformed entries one by one instead of widening or wiping', async () => {
      const parsed = parsePolicy({
        origins: {
          'https://ok.example': { level: 'read' },
          'https://ok.example/path': { level: 'write' },
          'https://typo.example': { level: 'admin' },
          'file:///': { level: 'read' },
          'https://quiet.example': { level: 'write', confirmWrites: false },
          'https://truthy.example': { level: 'write', confirmWrites: 0 },
        },
      });
      expect(Object.keys(parsed.origins).sort()).toEqualArray([
        'https://ok.example',
        'https://quiet.example',
        'https://truthy.example',
      ]);
      expect(parsed.origins['https://quiet.example']?.confirmWrites).toBe(false);
      // Only a literal false switches asking off — anything else keeps it on.
      expect(parsed.origins['https://truthy.example']?.confirmWrites).toBeUndefined();
    });
    await it('yields an empty policy for garbage', async () => {
      for (const raw of [null, 42, 'x', { origins: 'x' }, {}])
        expect(Object.keys(parsePolicy(raw).origins).length).toBe(0);
    });
  });
};
