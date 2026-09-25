import { describe, expect, it } from '@gjsify/unit';

import {
  PROTOCOL_VERSION,
  isExtensionOrigin,
  isLoopbackAddress,
  originKind,
  parseAgentHello,
  parseAgentReply,
  parseAgentRequest,
  parseAgentWelcome,
  parseFirstFrame,
  roleAllowed,
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

  const agentHello = {
    type: 'agent-hello',
    protocol: PROTOCOL_VERSION,
    token: 't0k3n',
    agent: { version: '0.1.0', pid: 42 },
  };

  await describe('parseFirstFrame', async () => {
    await it('tells an extension hello from an agent hello', async () => {
      const ext = parseFirstFrame(hello);
      const agent = parseFirstFrame(agentHello);
      expect(typeof ext === 'object' && ext.role === 'extension').toBe(true);
      expect(typeof agent === 'object' && agent.role === 'agent').toBe(true);
    });
    await it('names what is wrong with either', async () => {
      expect(parseFirstFrame({ ...agentHello, token: '' })).toBe('missing token');
      expect(parseFirstFrame({ ...agentHello, protocol: 99 })).toMatch(/protocol/);
      expect(parseFirstFrame({ ...agentHello, agent: { version: '1' } })).toBe('bad agent');
      expect(parseFirstFrame({ type: 'agent-call', id: 1 })).toBe('first frame must be hello');
    });
    await it('parseAgentHello refuses an extension hello', async () => {
      expect(parseAgentHello(hello)).toBe('first frame must be agent-hello');
    });
  });

  await describe('origin kind and role', async () => {
    await it('classifies handshake origins', async () => {
      expect(originKind(undefined)).toBe('none');
      expect(originKind('')).toBe('none');
      expect(originKind('moz-extension://abc-123')).toBe('extension');
      expect(originKind('https://evil.example')).toBe('page');
      expect(originKind('null')).toBe('page');
    });
    await it('allows exactly extension→extension and none→agent', async () => {
      expect(roleAllowed('extension', 'extension')).toBe(true);
      expect(roleAllowed('none', 'agent')).toBe(true);
      expect(roleAllowed('extension', 'agent')).toBe(false);
      expect(roleAllowed('none', 'extension')).toBe(false);
      expect(roleAllowed('page', 'agent')).toBe(false);
      expect(roleAllowed('page', 'extension')).toBe(false);
    });
    await it('recognises loopback addresses only', async () => {
      for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])
        expect(isLoopbackAddress(a)).toBe(true);
      for (const a of [undefined, '', '10.0.0.1', '::ffff:192.168.1.2', '1127.0.0.1', '127.0.0.1.evil'])
        expect(isLoopbackAddress(a)).toBe(false);
    });
  });

  await describe('agent frames', async () => {
    await it('parseAgentRequest accepts calls and status requests', async () => {
      expect(
        parseAgentRequest({ type: 'agent-call', id: 1, method: 'tabs.list', params: {} }),
      ).not.toBeNull();
      expect(
        parseAgentRequest({
          type: 'agent-call',
          id: 2,
          method: 'page.read',
          params: { tabId: 1 },
          browser: 'firefox',
        }),
      ).not.toBeNull();
      expect(parseAgentRequest({ type: 'agent-status', id: 3 })).not.toBeNull();
    });
    await it('parseAgentRequest refuses unknown methods and malformed frames — fail closed', async () => {
      expect(
        parseAgentRequest({ type: 'agent-call', id: 1, method: 'page.evaluate', params: {} }),
      ).toBeNull();
      expect(parseAgentRequest({ type: 'agent-call', id: 1, method: 'tabs.list' })).toBeNull();
      expect(parseAgentRequest({ type: 'agent-call', id: 1, method: 'tabs.list', params: [] })).toBeNull();
      expect(parseAgentRequest({ type: 'agent-call', id: 1.5, method: 'tabs.list', params: {} })).toBeNull();
      expect(
        parseAgentRequest({ type: 'agent-call', id: 1, method: 'tabs.list', params: {}, browser: 3 }),
      ).toBeNull();
      expect(parseAgentRequest({ type: 'request', id: 1, method: 'tabs.list', params: {} })).toBeNull();
      expect(parseAgentRequest(null)).toBeNull();
    });
    await it('parseAgentReply accepts ok and error replies, refuses the rest', async () => {
      expect(parseAgentReply({ type: 'agent-reply', id: 1, ok: true, result: {} })).not.toBeNull();
      expect(
        parseAgentReply({
          type: 'agent-reply',
          id: 1,
          ok: false,
          error: { code: 'forbidden', message: 'no' },
        }),
      ).not.toBeNull();
      expect(parseAgentReply({ type: 'agent-reply', id: 1, ok: false })).toBeNull();
      expect(parseAgentReply({ type: 'response', id: 1, ok: true })).toBeNull();
    });
    await it('parseAgentWelcome checks protocol and shape', async () => {
      const w = {
        type: 'agent-welcome',
        protocol: PROTOCOL_VERSION,
        bridge: { version: '1', pid: 5 },
        peerId: 'p',
      };
      expect(parseAgentWelcome(w)).not.toBeNull();
      expect(parseAgentWelcome({ ...w, protocol: 99 })).toBeNull();
      expect(parseAgentWelcome({ ...w, type: 'welcome' })).toBeNull();
    });
  });
};
