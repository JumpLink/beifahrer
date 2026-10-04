import { describe, expect, it } from '@gjsify/unit';
import { createServer, type Server } from 'node:net';
import { probePorts } from '@beifahrer/local';

// Above the ports the person's own agent sessions use (47813-47822), so a run beside them is safe.
const LISTENING = 52210;
const FREE = 52211;

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export default async () => {
  await describe('probePorts', async () => {
    await it('finds the port something listens on and not the free one beside it', async () => {
      const server = await listen(LISTENING);
      try {
        expect(await probePorts([LISTENING, FREE])).toStrictEqual([LISTENING]);
      } finally {
        server.close();
      }
    });

    await it('finds nothing once the listener is gone, and for an empty list', async () => {
      expect(await probePorts([LISTENING, FREE])).toStrictEqual([]);
      expect(await probePorts([])).toStrictEqual([]);
    });
  });
};
