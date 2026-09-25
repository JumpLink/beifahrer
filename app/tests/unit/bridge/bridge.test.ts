import { describe, expect, it } from '@gjsify/unit';
import { WebSocket } from 'ws';
import { ASK_TIMEOUT_MS, CLOSE, PROTOCOL_VERSION, PortRangeFull, type AgentSession } from '@beifahrer/core';

import {
  Bridge,
  BridgeError,
  DEFAULT_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  listenInRange,
  timeoutFor,
} from '../../../src/bridge/bridge.ts';

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

async function startBridge(extra: { browserWaitMs?: number; label?: string } = {}): Promise<Bridge> {
  const bridge = new Bridge({
    port: 0,
    token: TOKEN,
    version: 'test',
    timeoutMs: 2_000,
    helloTimeoutMs: 1_000,
    browserWaitMs: 0,
    ...extra,
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
    onSession?: (label: string) => void;
  } = {},
): Promise<{
  ws: WebSocket;
  welcome?: { connectionId: string; session?: AgentSession };
  closed?: number;
}> {
  return new Promise((resolve) => {
    // Three-argument form on purpose: @gjsify/ws 0.52.0 misreads `new WebSocket(url, options)` as
    // protocols and never sends the Origin. fixed upstream in gjsify: ws options as second argument
    const origin = opts.origin === undefined ? EXT : opts.origin;
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, undefined, origin ? { origin } : {});
    ws.on('open', () => ws.send(JSON.stringify(opts.hello ?? hello())));
    ws.on('message', (data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === 'welcome') resolve({ ws, welcome: frame });
      else if (frame.type === 'session') opts.onSession?.(frame.label);
      else if (frame.type === 'request') opts.onRequest?.(frame, ws);
    });
    ws.on('close', (code) => resolve({ ws, closed: code }));
    ws.on('error', () => undefined);
  });
}

export default async () => {
  await describe('timeoutFor', async () => {
    await it('gives a call that touches a site the access prompt on top of its own time', async () => {
      expect(timeoutFor('page.read')).toBe(DEFAULT_TIMEOUT_MS + ASK_TIMEOUT_MS);
      expect(timeoutFor('page.fill')).toBe(WRITE_TIMEOUT_MS + ASK_TIMEOUT_MS);
      expect(timeoutFor('tabs.list')).toBe(DEFAULT_TIMEOUT_MS);
      expect(timeoutFor('tabs.close')).toBe(WRITE_TIMEOUT_MS);
    });
  });

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

    await it('refuses the handshake without an Origin (a local process posing as a browser)', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { origin: '' });
      expect(r.welcome).toBeUndefined();
      expect(r.closed === CLOSE.unauthorized).toBe(false);
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

  await describe('Bridge sessions (ADR 0007)', async () => {
    await it('names its session in the welcome, and renames it live', async () => {
      const bridge = await startBridge({ label: 'claude-code · werkstatt' });
      let renamed = '';
      const r = await connect(bridge, { onSession: (l) => (renamed = l) });
      expect(r.welcome?.session?.label).toBe('claude-code · werkstatt');
      expect(r.welcome?.session?.instance).toBe(bridge.session.instance);
      expect(r.welcome?.session?.pid).toBe(process.pid);
      bridge.setLabel('other-client · werkstatt');
      for (let i = 0; i < 40 && !renamed; i++) await new Promise((res) => setTimeout(res, 25));
      expect(renamed).toBe('other-client · werkstatt');
      expect(bridge.status().session.label).toBe('other-client · werkstatt');
      r.ws.close();
      await bridge.stop();
    });

    await it('refuses the extension that dismissed THIS bridge, before registering it', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { hello: hello({ dismissed: bridge.session.instance }) });
      expect(r.closed).toBe(CLOSE.dismissed);
      expect(bridge.connections().length).toBe(0);
      await bridge.stop();
    });

    await it('welcomes an extension that dismissed another bridge on this port', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, { hello: hello({ dismissed: 'an-older-instance' }) });
      expect(typeof r.welcome?.connectionId).toBe('string');
      r.ws.close();
      await bridge.stop();
    });

    await it('checks the token before the dismissal', async () => {
      const bridge = await startBridge();
      const r = await connect(bridge, {
        hello: hello({ token: 'nope', dismissed: bridge.session.instance }),
      });
      expect(r.closed).toBe(CLOSE.unauthorized);
      await bridge.stop();
    });

    await it('a call waits for a browser that connects late, within browserWaitMs', async () => {
      const bridge = await startBridge({ browserWaitMs: 3_000 });
      const answered = bridge.call('tabs.list', {});
      await new Promise((res) => setTimeout(res, 300));
      const r = await connect(bridge, {
        onRequest: (req, ws) =>
          ws.send(JSON.stringify({ type: 'response', id: req.id, ok: true, result: { tabs: [] } })),
      });
      expect(Array.isArray((await answered).tabs)).toBe(true);
      r.ws.close();
      await bridge.stop();
    });

    await it('each bridge serves only the browsers connected to it', async () => {
      const a = await startBridge({ label: 'a' });
      const b = await startBridge({ label: 'b' });
      const ra = await connect(a, {
        onRequest: (req, ws) =>
          ws.send(JSON.stringify({ type: 'response', id: req.id, ok: true, result: { tag: 'a' } })),
      });
      const rb = await connect(b, {
        onRequest: (req, ws) =>
          ws.send(JSON.stringify({ type: 'response', id: req.id, ok: true, result: { tag: 'b' } })),
      });
      expect(((await a.call('tabs.list', {})) as unknown as { tag: string }).tag).toBe('a');
      expect(((await b.call('tabs.list', {})) as unknown as { tag: string }).tag).toBe('b');
      // One session ending leaves the other untouched.
      await a.stop();
      expect(((await b.call('tabs.list', {})) as unknown as { tag: string }).tag).toBe('b');
      ra.ws.close();
      rb.ws.close();
      await b.stop();
    });
  });

  await describe('listenInRange', async () => {
    // A random high range, far from the person's 47813–47822 and the e2e's 479xx.
    const base = 50_000 + Math.floor(Math.random() * 10_000);
    const opts = { token: TOKEN, version: 'test' };

    await it('binds the first free port, skipping a taken one', async () => {
      const taken = new Bridge({ ...opts, port: base });
      await taken.start();
      const next = await listenInRange({ base, count: 3 }, opts);
      expect(next.port).toBe(base + 1);
      const third = await listenInRange({ base, count: 3 }, opts);
      expect(third.port).toBe(base + 2);
      await Promise.all([taken.stop(), next.stop(), third.stop()]);
    });

    await it('says so when the whole range is taken', async () => {
      const a = await listenInRange({ base, count: 2 }, opts);
      const b = await listenInRange({ base, count: 2 }, opts);
      let caught: unknown;
      await listenInRange({ base, count: 2 }, opts).catch((e) => (caught = e));
      expect(caught instanceof PortRangeFull).toBe(true);
      expect((caught as Error).message).toMatch(/every port of 127\.0\.0\.1:/);
      await Promise.all([a.stop(), b.stop()]);
      // Freed: the next session gets the first port again.
      const again = await listenInRange({ base, count: 2 }, opts);
      expect(again.port).toBe(base);
      await again.stop();
    });
  });
};
