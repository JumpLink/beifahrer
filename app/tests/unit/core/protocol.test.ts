import { describe, expect, it } from '@gjsify/unit';

import {
  PROTOCOL_VERSION,
  SESSION_LABEL_MAX,
  cleanSessionLabel,
  defaultSessionLabel,
  isExtensionOrigin,
  isLoopbackAddress,
  parseHello,
  parseResponse,
  parseWelcome,
  toTabInfo,
  tokensEqual,
} from '@beifahrer/core';

const hello = {
  type: 'hello',
  protocol: PROTOCOL_VERSION,
  token: 't0k3n',
  browser: { family: 'firefox', name: 'Firefox', version: '155.0' },
  extension: { version: '0.1.0', manifestVersion: 2 },
  capabilities: ['tabs.list'],
};

export default async () => {
  await describe('isExtensionOrigin', async () => {
    await it('accepts the origins browsers put on extension handshakes', async () => {
      expect(isExtensionOrigin('moz-extension://0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7')).toBe(true);
      expect(isExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
      expect(isExtensionOrigin('ephy-webextension://343a154c-cf7b-4d0f-9132-e44bdb1756aa')).toBe(true);
    });
    await it('refuses web pages, missing and look-alike origins', async () => {
      for (const o of [
        undefined,
        null,
        '',
        'null',
        'https://evil.example',
        'http://127.0.0.1',
        'moz-extension://x/y',
        'moz-extension://x.evil.example',
      ]) {
        expect(isExtensionOrigin(o)).toBe(false);
      }
    });
  });

  await describe('parseHello', async () => {
    await it('accepts a well-formed hello', async () => {
      expect(typeof parseHello(hello)).toBe('object');
    });
    await it('names what is wrong', async () => {
      expect(parseHello({ ...hello, protocol: 99 })).toMatch(/protocol/);
      expect(parseHello({ ...hello, token: '' })).toBe('missing token');
      expect(parseHello({ ...hello, type: 'welcome' })).toBe('first frame must be hello');
      expect(parseHello({ ...hello, extension: { version: '1', manifestVersion: 4 } })).toBe('bad extension');
      expect(parseHello(null)).toBe('first frame must be hello');
    });
  });

  await describe('parseResponse', async () => {
    await it('accepts ok and error responses, refuses the rest', async () => {
      expect(parseResponse({ type: 'response', id: 1, ok: true, result: 1 })).not.toBeNull();
      expect(
        parseResponse({ type: 'response', id: 1, ok: false, error: { code: 'denied', message: 'no' } }),
      ).not.toBeNull();
      expect(parseResponse({ type: 'response', id: 1, ok: false })).toBeNull();
      expect(parseResponse({ type: 'response', id: '1', ok: true })).toBeNull();
    });
  });

  await describe('tokensEqual', async () => {
    await it('compares whole strings', async () => {
      expect(tokensEqual('abc', 'abc')).toBe(true);
      expect(tokensEqual('abc', 'abd')).toBe(false);
      expect(tokensEqual('abc', 'abcd')).toBe(false);
      expect(tokensEqual('', 'a')).toBe(false);
    });
  });

  await describe('toTabInfo', async () => {
    const policy = { origins: { 'https://ok.example': { level: 'read' as const } } };
    await it('shows only the host of a tab below read — no path, no title', async () => {
      const info = toTabInfo(
        {
          id: 3,
          windowId: 1,
          active: true,
          url: 'https://bank.example/konto?iban=DE00',
          title: 'Kontostand 1.234 €',
        },
        policy,
        1,
      )!;
      expect(info.host).toBe('bank.example');
      expect(info.level).toBe('none');
      expect(info.url).toBeUndefined();
      expect(info.title).toBeUndefined();
      expect(JSON.stringify(info).includes('iban')).toBe(false);
      expect(JSON.stringify(info).includes('Kontostand')).toBe(false);
      expect(info.focusedWindow).toBe(true);
    });
    await it('shows url and title from read upward', async () => {
      const info = toTabInfo({ id: 4, windowId: 2, url: 'https://ok.example/a', title: 'A' }, policy, 1)!;
      expect(info.url).toBe('https://ok.example/a');
      expect(info.title).toBe('A');
      expect(info.focusedWindow).toBe(false);
    });
    await it('skips a tab without ids', async () => {
      expect(toTabInfo({ url: 'https://ok.example/' }, policy, null)).toBeNull();
    });
  });

  await describe('loopback', async () => {
    await it('recognises loopback addresses only', async () => {
      for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])
        expect(isLoopbackAddress(a)).toBe(true);
      for (const a of [undefined, '', '10.0.0.1', '::ffff:192.168.1.2', '1127.0.0.1', '127.0.0.1.evil'])
        expect(isLoopbackAddress(a)).toBe(false);
    });
  });

  await describe('agent sessions (ADR 0007)', async () => {
    const session = {
      label: 'claude-code · werkstatt',
      pid: 42,
      instance: 'i-1',
      startedAt: '2026-09-25T10:00:00Z',
    };
    const welcome = {
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      bridge: { version: '0.1.0' },
      connectionId: 'c1',
      session,
    };

    await it('parseHello takes an optional dismissed instance, and only a string', async () => {
      expect(typeof parseHello({ ...hello, dismissed: 'i-1' })).toBe('object');
      expect(parseHello({ ...hello, dismissed: 5 })).toBe('bad dismissed');
    });

    await it('parseWelcome reads the session, and accepts a welcome without one (older bridge)', async () => {
      expect(parseWelcome(welcome)?.session?.label).toBe('claude-code · werkstatt');
      const { session: _, ...old } = welcome;
      const parsed = parseWelcome(old);
      expect(parsed?.connectionId).toBe('c1');
      expect(parsed?.session).toBeUndefined();
    });

    await it('parseWelcome refuses a malformed session instead of showing half of it', async () => {
      expect(parseWelcome({ ...welcome, session: { ...session, instance: '' } })).toBeNull();
      expect(parseWelcome({ ...welcome, session: { ...session, label: '\u0000\u0007' } })).toBeNull();
      expect(parseWelcome({ ...welcome, type: 'hello' })).toBeNull();
      expect(parseWelcome(null)).toBeNull();
    });

    await it('cleanSessionLabel flattens, strips control and bidi characters, and caps', async () => {
      expect(cleanSessionLabel('  a\n\tb  ')).toBe('a b');
      expect(cleanSessionLabel('evil\u202Eeman')).toBe('evil eman');
      expect(cleanSessionLabel('x'.repeat(200))?.length).toBe(SESSION_LABEL_MAX);
      expect(cleanSessionLabel('')).toBeNull();
      expect(cleanSessionLabel(7)).toBeNull();
    });

    await it('defaultSessionLabel is the client and the directory basename', async () => {
      expect(defaultSessionLabel('claude-code', '/home/p/Projekte/werkstatt')).toBe(
        'claude-code · werkstatt',
      );
      expect(defaultSessionLabel('claude-code', '/home/p/werkstatt/')).toBe('claude-code · werkstatt');
      expect(defaultSessionLabel('beifahrer tool', 'C:\\work\\repo')).toBe('beifahrer tool · repo');
      expect(defaultSessionLabel('mcp', '/')).toBe('mcp · /');
    });
  });
};
