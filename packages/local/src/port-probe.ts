/**
 * Which of `ports` on 127.0.0.1 accept a TCP connection. The only thing it sends is the connect: no
 * bytes, no handshake, so a bridge sees a client that came and went and a foreign program sees the
 * same. It never asks what is there; the registry is where a bridge says who it is.
 */

import { createConnection } from 'node:net';

const PROBE_TIMEOUT_MS = 500;

function accepts(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = (listening: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(listening);
    };
    // A refused connection is the normal answer for a free port; a silent one is not "listening".
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function probePorts(ports: readonly number[], timeoutMs = PROBE_TIMEOUT_MS): Promise<number[]> {
  const answers = await Promise.all(ports.map((p) => accepts(p, timeoutMs)));
  return ports.filter((_, i) => answers[i]);
}
