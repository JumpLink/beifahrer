import { describe, expect, it } from '@gjsify/unit';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type AgentRequest, type HubStatus } from '@beifahrer/core';

import { Bridge, BridgeError, answerAgentRequest, handshakeOriginKind } from '../../../src/bridge/bridge.ts';
import { HubClient, SharedBridge } from '../../../src/bridge/shared.ts';

const TOKEN = 'test-token-456';
const EXT = 'moz-extension://0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A fake extension that answers every request with `{ tag, method }`, or with a forbidden error
 * for page.read. Resolves once welcomed.
 */
function fakeExtension(port: number, tag: string, opts: { hang?: boolean } = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Three-argument form + trailing `/`: @gjsify/ws 0.52.0 (AGENTS.md "gjsify gaps").
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, undefined, { origin: EXT });
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: TOKEN,
          browser: { family: 'firefox', name: 'Firefox', version: '155.0' },
          extension: { version: '0.1.0', manifestVersion: 2 },
          capabilities: ['tabs.list', 'page.read', 'page.click'],
        }),
      ),
    );
    ws.on('message', (data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === 'welcome') resolve(ws);
      if (frame.type !== 'request' || opts.hang) return;
      ws.send(
        JSON.stringify(
          frame.method === 'page.read'
            ? {
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'forbidden',
                  message: 'no',
                  origin: 'https://x.example',
                  have: 'none',
                  need: 'read',
                },
              }
            : { type: 'response', id: frame.id, ok: true, result: { tag, method: frame.method } },
        ),
      );
    });
    ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    ws.on('error', () => undefined);
  });
}

async function startHub(): Promise<Bridge> {
  const hub = new Bridge({ port: 0, token: TOKEN, version: 'test', timeoutMs: 2_000, helloTimeoutMs: 1_000 });
  await hub.start();
  return hub;
}

/** Election needs a port both sides know in advance, so port 0 does not work here. */
const electionPort = () => 42000 + Math.floor(Math.random() * 20000);

export default async () => {
  await describe('answerAgentRequest (no sockets)', async () => {
    const hub = {
      call: async (method: string) => {
        if (method === 'page.read') throw new BridgeError({ code: 'forbidden', message: 'no', need: 'read' });
        if (method === 'tabs.active') throw new Error('boom');
        return { method } as never;
      },
      status: (): HubStatus => ({ port: 1, hub: { pid: 2, version: 'v', peers: 3 }, browsers: [] }),
    };
    await it('answers a call with the hub result', async () => {
      const req: AgentRequest = { type: 'agent-call', id: 7, method: 'tabs.list', params: {} };
      const reply = await answerAgentRequest(req, hub);
      expect(reply.ok).toBe(true);
      expect(reply.id).toBe(7);
    });
    await it('passes a wire error through unchanged', async () => {
      const reply = await answerAgentRequest(
        { type: 'agent-call', id: 8, method: 'page.read', params: { tabId: 1 } },
        hub,
      );
      expect(reply.ok).toBe(false);
      if (!reply.ok) {
        expect(reply.error.code).toBe('forbidden');
        expect(reply.error.need).toBe('read');
      }
    });
    await it('turns any other failure into failed', async () => {
      const reply = await answerAgentRequest(
        { type: 'agent-call', id: 9, method: 'tabs.active', params: {} },
        hub,
      );
      expect(!reply.ok && reply.error.code === 'failed' && reply.error.message === 'boom').toBe(true);
    });
    await it('answers a status request', async () => {
      const reply = await answerAgentRequest({ type: 'agent-status', id: 1 }, hub);
      expect(reply.ok && (reply.result as HubStatus).hub.peers === 3).toBe(true);
    });
  });

  await describe('handshakeOriginKind', async () => {
    await it('reads a Node request', async () => {
      expect(handshakeOriginKind({ headers: {} })).toBe('none');
      expect(handshakeOriginKind({ headers: { origin: EXT } })).toBe('extension');
      expect(handshakeOriginKind({ headers: { origin: 'https://evil.example' } })).toBe('page');
      expect(handshakeOriginKind({ headers: { 'sec-websocket-origin': 'https://evil.example' } })).toBe(
        'page',
      );
    });
    await it('reads a Soup.ServerMessage', async () => {
      const soup = (origin: string | null) => ({
        get_request_headers: () => ({ get_one: (name: string) => (name === 'Origin' ? origin : null) }),
      });
      expect(handshakeOriginKind(soup(null))).toBe('none');
      expect(handshakeOriginKind(soup(EXT))).toBe('extension');
      expect(handshakeOriginKind(soup('https://evil.example'))).toBe('page');
    });
    await it('fails closed on anything else', async () => {
      expect(handshakeOriginKind(undefined)).toBe('page');
      expect(handshakeOriginKind({})).toBe('page');
    });
  });

  await describe('Relay through the hub', async () => {
    await it('forwards a call and returns the result', async () => {
      const hub = await startHub();
      const ext = await fakeExtension(hub.port, 'ff');
      const peer = await HubClient.connect({ port: hub.port, token: TOKEN, version: 'test' });
      const result = (await peer.call('tabs.list', {})) as unknown as { tag: string; method: string };
      expect(result.tag).toBe('ff');
      expect(result.method).toBe('tabs.list');
      peer.close();
      ext.close();
      await hub.stop();
    });

    await it('returns a browser error unchanged', async () => {
      const hub = await startHub();
      const ext = await fakeExtension(hub.port, 'ff');
      const peer = await HubClient.connect({ port: hub.port, token: TOKEN, version: 'test' });
      let caught: unknown;
      await peer.call('page.read', { tabId: 1 }).catch((e) => (caught = e));
      expect(caught instanceof BridgeError).toBe(true);
      expect((caught as BridgeError).wire.code).toBe('forbidden');
      expect((caught as BridgeError).wire.origin).toBe('https://x.example');
      peer.close();
      ext.close();
      await hub.stop();
    });

    await it('reports browsers and the peer count', async () => {
      const hub = await startHub();
      const ext = await fakeExtension(hub.port, 'ff');
      const peer = await HubClient.connect({ port: hub.port, token: TOKEN, version: 'test' });
      const status = await peer.status();
      expect(status.hub.peers).toBe(1);
      expect(status.browsers.length).toBe(1);
      expect(status.browsers[0]!.browser.family).toBe('firefox');
      expect(JSON.stringify(status).includes(TOKEN)).toBe(false);
      peer.close();
      ext.close();
      await hub.stop();
    });

    await it('fails a pending call at once when the hub goes away', async () => {
      const hub = await startHub();
      const ext = await fakeExtension(hub.port, 'ff', { hang: true });
      const peer = await HubClient.connect({ port: hub.port, token: TOKEN, version: 'test' });
      const started = Date.now();
      const pending = peer.call('page.click', { tabId: 1, ref: 'e1' }).catch((e) => e);
      await sleep(200);
      await hub.stop();
      const caught = (await pending) as BridgeError;
      expect(caught instanceof BridgeError).toBe(true);
      expect(caught.wire.message).toMatch(/went away/);
      expect(Date.now() - started < 5_000).toBe(true);
      ext.close();
    });

    await it('refuses a peer with the wrong token for good', async () => {
      const hub = await startHub();
      let caught: unknown;
      await HubClient.connect({ port: hub.port, token: 'nope', version: 'test' }).catch((e) => (caught = e));
      expect(caught instanceof Error).toBe(true);
      expect(hub.peerCount()).toBe(0);
      await hub.stop();
    });
  });

  await describe('SharedBridge election', async () => {
    await it('first binds, second relays, and the second takes over when the first stops', async () => {
      const port = electionPort();
      const a = new SharedBridge({ port, token: TOKEN, version: 'test', timeoutMs: 2_000 });
      const b = new SharedBridge({ port, token: TOKEN, version: 'test', timeoutMs: 2_000 });
      expect(await a.start()).toBe('hub');
      expect(await b.start()).toBe('peer');

      const ext1 = await fakeExtension(port, 'first');
      const viaPeer = (await b.call('tabs.list', {})) as unknown as { tag: string };
      expect(viaPeer.tag).toBe('first');
      const status = await b.status();
      expect(status.role).toBe('peer');
      expect(status.hub.peers).toBe(1);
      expect(status.browsers.length).toBe(1);

      await a.stop();
      ext1.close();
      // b notices, binds the port itself; the extension reconnects on its own.
      let role: string | null = null;
      for (let i = 0; i < 40 && role !== 'hub'; i++) {
        await sleep(100);
        role = b.role;
      }
      expect(role).toBe('hub');
      const ext2 = await fakeExtension(port, 'second');
      const afterTakeover = (await b.call('tabs.list', {})) as unknown as { tag: string };
      expect(afterTakeover.tag).toBe('second');
      expect((await b.status()).role).toBe('hub');
      ext2.close();
      await b.stop();
    });
  });
};
