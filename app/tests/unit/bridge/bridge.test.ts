import { describe, expect, it } from '@gjsify/unit';
import { WebSocket } from 'ws';
import { CLOSE, PROTOCOL_VERSION } from '@beifahrer/core';

import { Bridge, BridgeError } from '../../../src/bridge/bridge.ts';

const TOKEN = 'test-token-123';
const EXT = 'moz-extension://0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7';

function hello(extra: Record<string, unknown> = {}) {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    token: TOKEN,
    browser: { family: 'firefox', name: 'Firefox', version: '155.0' },
    extension: { version: '0.1.0', manifestVersion: 2 },
    capabilities: ['tabs.list', 'page.read'],
    ...extra,
  };
}

async function startBridge(): Promise<Bridge> {
  const bridge = new Bridge({
    port: 0,
    token: TOKEN,
    version: 'test',
    timeoutMs: 2_000,
    helloTimeoutMs: 1_000,
  });
  await bridge.start();
  return bridge;
}

/** A fake extension. Resolves with the socket once welcomed, or with the close code. */
function connect(
  bridge: Bridge,
  opts: {
    origin?: string;
    hello?: unknown;
    onRequest?: (req: { id: number; method: string; params: unknown }, ws: WebSocket) => void;
  } = {},
): Promise<{ ws: WebSocket; welcome?: { connectionId: string }; closed?: number }> {
  return new Promise((resolve) => {
    // Three-argument form on purpose: @gjsify/ws 0.52.0 misreads `new WebSocket(url, options)` as
    // protocols and never sends the Origin. fixed upstream in gjsify: ws options as second argument
    const origin = opts.origin === undefined ? EXT : opts.origin;
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, undefined, origin ? { origin } : {});
    ws.on('open', () => ws.send(JSON.stringify(opts.hello ?? hello())));
    ws.on('message', (data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === 'welcome') resolve({ ws, welcome: frame });
      else if (frame.type === 'request') opts.onRequest?.(frame, ws);
    });
    ws.on('close', (code) => resolve({ ws, closed: code }));
    ws.on('error', () => undefined);
  });
}

export default async () => {
  await describe('Bridge admission', async () => {
    await it('refuses the handshake when the Origin is a web page', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { origin: 'https://evil.example' });
      // A refused handshake never opens: the client sees an abnormal close, not a close frame.
      expect(r.welcome).toBeUndefined();
      expect(r.closed === CLOSE.unauthorized).toBe(false);
      expect(bridge.connections().length).toBe(0);
      await bridge.stop();
    });

    await it('refuses the handshake without an Origin (a local non-browser process)', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { origin: '' });
      expect(r.welcome).toBeUndefined();
      expect(bridge.connections().length).toBe(0);
      await bridge.stop();
    });

    await it('closes a connection with the wrong token', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { hello: hello({ token: 'nope' }) });
      expect(r.closed).toBe(CLOSE.unauthorized);
      await bridge.stop();
    });

    await it('closes with the protocol code on a version mismatch', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { hello: hello({ protocol: 99 }) });
      expect(r.closed).toBe(CLOSE.protocol);
      await bridge.stop();
    });

    await it('welcomes a paired extension', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge);
      expect(typeof r.welcome?.connectionId).toBe('string');
      expect(bridge.connections().length).toBe(1);
      r.ws.close();
      await bridge.stop();
    });
  });

  await describe('Bridge calls', async () => {
    await it('routes a request and returns the result', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, {
        onRequest: (req, ws) =>
          ws.send(
            JSON.stringify({
              type: 'response',
              id: req.id,
              ok: true,
              result: { tabs: [], echo: req.method },
            }),
          ),
      });
      const result = (await bridge.call('tabs.list', {})) as unknown as { echo: string };
      expect(result.echo).toBe('tabs.list');
      r.ws.close();
      await bridge.stop();
    });

    await it('turns an error response into a BridgeError carrying the wire error', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, {
        onRequest: (req, ws) =>
          ws.send(
            JSON.stringify({
              type: 'response',
              id: req.id,
              ok: false,
              error: {
                code: 'forbidden',
                message: 'no',
                origin: 'https://x.example',
                have: 'none',
                need: 'read',
              },
            }),
          ),
      });
      let caught: unknown;
      await bridge.call('page.read', { tabId: 1 }).catch((e) => (caught = e));
      expect(caught instanceof BridgeError).toBe(true);
      expect((caught as BridgeError).wire.code).toBe('forbidden');
      expect((caught as BridgeError).wire.need).toBe('read');
      r.ws.close();
      await bridge.stop();
    });

    await it('refuses a method the browser did not announce', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge);
      let caught: unknown;
      await bridge.call('page.screenshot', { tabId: 1 }).catch((e) => (caught = e));
      expect((caught as BridgeError).wire.code).toBe('unsupported');
      r.ws.close();
      await bridge.stop();
    });

    await it('rejects pending calls when the browser goes away', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { onRequest: (_req, ws) => ws.close() });
      let caught: unknown;
      await bridge.call('tabs.list', {}).catch((e) => (caught = e));
      expect((caught as BridgeError).wire.message).toMatch(/disconnected/);
      r.ws.close();
      await bridge.stop();
    });

    await it('says so when nothing is connected', async () => {
      const bridge = await startBridge();
      let caught: unknown;
      await bridge.call('tabs.list', {}).catch((e) => (caught = e));
      expect((caught as BridgeError).wire.message).toMatch(/no browser is connected/);
      await bridge.stop();
    });

    await it('asks which browser when two are connected, and picks by family', async () => {
      const bridge = await startBridge();
      const answer = (tag: string) => (req: { id: number }, ws: WebSocket) =>
        ws.send(JSON.stringify({ type: 'response', id: req.id, ok: true, result: { tag } }));
      const a = await connect(bridge, { onRequest: answer('firefox') });
      const b = await connect(bridge, {
        origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        hello: hello({
          browser: { family: 'chromium', name: 'Chromium', version: '140' },
          extension: { version: '0.1.0', manifestVersion: 3 },
        }),
        onRequest: answer('chromium'),
      });
      let caught: unknown;
      await bridge.call('tabs.list', {}).catch((e) => (caught = e));
      expect((caught as BridgeError).wire.code).toBe('invalid');
      const viaChromium = (await bridge.call('tabs.list', {}, 'chromium')) as unknown as { tag: string };
      expect(viaChromium.tag).toBe('chromium');
      a.ws.close();
      b.ws.close();
      await bridge.stop();
    });
  });
};
