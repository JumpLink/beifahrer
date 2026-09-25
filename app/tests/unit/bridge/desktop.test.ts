import { describe, expect, it } from '@gjsify/unit';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type DesktopInfo } from '@beifahrer/core';

import { Bridge } from '../../../src/bridge/bridge.ts';
import { desktopSource, followDesktop, readDesktop, type AccentSource } from '../../../src/bridge/desktop.ts';

const TOKEN = 'test-token-desktop';
const EXT = 'moz-extension://0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7';

/** GSettings stand-in: a value and the `changed::accent-color` signal. */
function fakeSettings(initial: string | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  const source: AccentSource = {
    read: () => value,
    watch(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
  return {
    source,
    listeners,
    set(next: string | null) {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}

interface Connected {
  ws: WebSocket;
  welcome: { desktop?: DesktopInfo };
  frames: DesktopInfo[];
}

/** A fake extension: resolves with the welcome, and records every `desktop` frame after it. */
function connect(bridge: Bridge): Promise<Connected> {
  const frames: DesktopInfo[] = [];
  return new Promise((resolve, reject) => {
    // Three-argument form, as in bridge.test.ts. fixed upstream in gjsify: ws options as second argument
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, undefined, { origin: EXT });
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: TOKEN,
          browser: { family: 'firefox', name: 'Firefox', version: '155.0' },
          extension: { version: '0.1.0', manifestVersion: 2 },
          capabilities: ['tabs.list'],
        }),
      ),
    );
    ws.on('message', (data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === 'welcome') resolve({ ws, welcome: frame, frames });
      else if (frame.type === 'desktop') frames.push(frame.desktop);
    });
    ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    ws.on('error', () => undefined);
  });
}

async function startBridge(desktop: AccentSource | null): Promise<Bridge> {
  const bridge = new Bridge({ port: 0, token: TOKEN, version: 'test', helloTimeoutMs: 1_000, desktop });
  await bridge.start();
  return bridge;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !done(); i++) await new Promise((r) => setTimeout(r, 25));
}

export default async () => {
  await describe('desktop source', async () => {
    await it('reads a known accent and nothing else', async () => {
      expect(readDesktop(fakeSettings('purple').source).accent).toBe('purple');
      expect(readDesktop(fakeSettings('magenta').source).accent).toBeUndefined();
      expect(readDesktop(fakeSettings(null).source).accent).toBeUndefined();
      expect(readDesktop(null).accent).toBeUndefined();
    });

    await it('BEIFAHRER_DESKTOP_ACCENT overrides the desktop (test-only)', async () => {
      expect(readDesktop(desktopSource({ BEIFAHRER_DESKTOP_ACCENT: 'green' })).accent).toBe('green');
      expect(readDesktop(desktopSource({ BEIFAHRER_DESKTOP_ACCENT: 'lime' })).accent).toBeUndefined();
    });

    await it('followDesktop pushes now, on every change, and stops when unsubscribed', async () => {
      const fake = fakeSettings('blue');
      const seen: (string | undefined)[] = [];
      const stop = followDesktop(fake.source, (d) => seen.push(d.accent));
      fake.set('red');
      stop();
      fake.set('pink');
      expect(seen.join(',')).toBe('blue,red');
      expect(fake.listeners.size).toBe(0);
    });
  });

  await describe('Bridge and the desktop', async () => {
    await it('welcomes with the accent, then sends a desktop frame when it changes', async () => {
      const fake = fakeSettings('purple');
      const bridge = await startBridge(fake.source);
      const r = await connect(bridge);
      expect(r.welcome.desktop?.accent).toBe('purple');
      fake.set('purple'); // unchanged: no frame
      fake.set('teal');
      await until(() => r.frames.length > 0);
      expect(r.frames.length).toBe(1);
      expect(r.frames[0]?.accent).toBe('teal');
      r.ws.close();
      await bridge.stop();
      expect(fake.listeners.size).toBe(0);
    });

    await it('welcomes without a desktop where there is no source (Node, non-GNOME)', async () => {
      const bridge = await startBridge(null);
      const r = await connect(bridge);
      expect(r.welcome.desktop).toBeUndefined();
      r.ws.close();
      await bridge.stop();
    });
  });
};
