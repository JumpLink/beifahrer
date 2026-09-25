import type { CommandModule } from 'yargs';
import { DEFAULT_PORT, isMethod } from '@beifahrer/core';

import { Bridge, BridgeError, label } from '../../bridge/bridge.ts';
import { loadOrCreateToken, newToken, tokenPath, writeToken } from '../../bridge/token.ts';
import { VERSION } from '../../version.ts';
import { startMcpServer } from '../mcp/server.ts';

const portOption = {
  type: 'number',
  describe: `Loopback port (default ${DEFAULT_PORT}, or $BEIFAHRER_PORT)`,
} as const;

const portOf = (argv: { port?: number }) => argv.port ?? (Number(process.env.BEIFAHRER_PORT) || DEFAULT_PORT);

/** Every command but `mcp` finishes; this is how it ends — explicitly, see mcp/runtime.ts. */
function finish(code: number): never {
  return process.exit(code);
}

export const mcpCommand: CommandModule<object, { port?: number; 'allow-write'?: boolean }> = {
  command: 'mcp',
  describe: 'Serve MCP over stdio and the browser bridge on 127.0.0.1',
  builder: (y) =>
    y.option('port', portOption).option('allow-write', {
      type: 'boolean',
      describe:
        'Expose page_fill / page_click / tab_open (also: BEIFAHRER_MCP_ALLOW_WRITE=1). The browser still asks.',
    }),
  handler: (argv) => {
    startMcpServer({ port: argv.port, allowWrite: argv['allow-write'] }).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      finish(1);
    });
  },
};

export const tokenCommand: CommandModule<object, { rotate?: boolean }> = {
  command: 'token',
  describe: 'Print the pairing token to paste into the extension (created on first use)',
  builder: (y) =>
    y.option('rotate', { type: 'boolean', describe: 'Replace it; every paired browser must be re-paired' }),
  handler: (argv) => {
    const path = tokenPath();
    if (argv.rotate) writeToken(path, newToken());
    const { token } = loadOrCreateToken(path);
    console.log(token);
    console.error(`(stored in ${path})`);
    finish(0);
  },
};

export const callCommand: CommandModule<
  object,
  { method: string; params?: string; browser?: string; port?: number; wait: number }
> = {
  command: 'call <method> [params]',
  describe: 'Start the bridge, wait for a browser, send one request, print the answer (for testing)',
  builder: (y) =>
    y
      .positional('method', { type: 'string', demandOption: true, describe: 'tabs.list, page.outline, …' })
      .positional('params', { type: 'string', describe: 'JSON object' })
      .option('browser', { type: 'string' })
      .option('port', portOption)
      .option('wait', { type: 'number', default: 30, describe: 'Seconds to wait for a browser' }),
  handler: (argv) => {
    void (async () => {
      if (!isMethod(argv.method)) {
        console.error(`unknown method ${argv.method}`);
        return finish(2);
      }
      const bridge = new Bridge({ port: portOf(argv), token: loadOrCreateToken().token, version: VERSION });
      await bridge.start();
      try {
        await bridge.waitForConnection(argv.wait * 1000);
        // A second browser that is also paired connects within a moment; give it that moment so
        // `--browser` can pick it instead of racing the first one in.
        if (argv.browser) await new Promise((r) => setTimeout(r, 1500));
        const result = await bridge.call(argv.method, JSON.parse(argv.params ?? '{}'), argv.browser);
        console.log(JSON.stringify(result, null, 2));
        await bridge.stop();
        return finish(0);
      } catch (err) {
        console.error(
          err instanceof BridgeError ? `${err.wire.code}: ${err.message}` : (err as Error).message,
        );
        await bridge.stop();
        return finish(1);
      }
    })();
  },
};

export const serveCommand: CommandModule<object, { port?: number }> = {
  command: 'serve',
  describe: 'Run only the bridge and log browsers connecting (for checking the pairing)',
  builder: (y) => y.option('port', portOption),
  handler: (argv) => {
    void (async () => {
      const bridge = new Bridge({ port: portOf(argv), token: loadOrCreateToken().token, version: VERSION });
      bridge.on('connected', (c) =>
        console.log(
          `connected: ${label(c)} — MV${c.hello.extension.manifestVersion}, ${c.hello.capabilities.length} methods`,
        ),
      );
      bridge.on('disconnected', (id) => console.log(`disconnected: ${id}`));
      await bridge.start();
      console.log(`listening on 127.0.0.1:${bridge.port} — Ctrl+C to stop`);
    })().catch((err) => {
      console.error((err as Error).message);
      finish(1);
    });
  },
};
