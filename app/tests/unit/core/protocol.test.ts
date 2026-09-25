import { describe, expect, it } from '@gjsify/unit';

import {
  PROTOCOL_VERSION,
  isExtensionOrigin,
  parseHello,
  parseResponse,
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
};
