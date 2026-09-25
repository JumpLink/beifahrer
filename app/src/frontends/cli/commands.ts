import type { CommandModule } from 'yargs';
import { describeRange, isMethod } from '@beifahrer/core';

import { BridgeError, label, listenInRange, type Bridge } from '../../bridge/bridge.ts';
import { rangeOf, rangeOptions, sessionLabel, type RangeArgs } from '../../bridge/session.ts';
import { loadOrCreateToken, newToken, tokenPath, writeToken } from '../../bridge/token.ts';
import { VERSION } from '../../version.ts';
import { startMcpServer } from '../mcp/server.ts';

/** Every command but `mcp` finishes; this is how it ends — explicitly, see mcp/runtime.ts. */
function finish(code: number): never {
  return process.exit(code);
}

export const mcpCommand: CommandModule<object, RangeArgs & { 'allow-write'?: boolean }> = {
  command: 'mcp',
  describe: "Serve MCP over stdio, with this session's own browser bridge on 127.0.0.1",
  builder: (y) =>
    y.options(rangeOptions).option('allow-write', {
      type: 'boolean',
      describe:
        'Expose page_fill / page_click / tab_open (also: BEIFAHRER_MCP_ALLOW_WRITE=1). The browser still asks.',
    }),
  handler: (argv) => {
    startMcpServer({ range: rangeOf(argv), allowWrite: argv['allow-write'] }).catch((err) => {
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
  RangeArgs & { method: string; params?: string; browser?: string; wait: number }
> = {
  command: 'call <method> [params]',
  describe:
    'Send one request to a browser and print the answer (for testing). Binds its own port of the range and waits for the extension to find it.',
  builder: (y) =>
    y
      .positional('method', { type: 'string', demandOption: true, describe: 'tabs.list, page.outline, …' })
      .positional('params', { type: 'string', describe: 'JSON object' })
      .option('browser', { type: 'string' })
      .options(rangeOptions)
      .option('wait', { type: 'number', default: 20, describe: 'Seconds to wait for a browser' }),
  handler: (argv) => {
    void (async () => {
      if (!isMethod(argv.method)) {
        console.error(`unknown method ${argv.method}`);
        return finish(2);
      }
      let bridge: Bridge | null = null;
      try {
        bridge = await listenInRange(rangeOf(argv), {
          token: loadOrCreateToken().token,
          version: VERSION,
          label: sessionLabel('beifahrer call'),
        });
        await waitForBrowser(bridge, argv.wait * 1000, argv.browser ? 2 : 1);
        const result = await bridge.call(argv.method, JSON.parse(argv.params ?? '{}'), argv.browser);
        console.log(JSON.stringify(result, null, 2));
        await bridge.stop();
        return finish(0);
      } catch (err) {
        console.error(
          err instanceof BridgeError ? `${err.wire.code}: ${err.message}` : (err as Error).message,
        );
        await bridge?.stop();
        return finish(1);
      }
    })();
  },
};

/**
 * Wait until the extension has found this bridge. With `want` 2 (`--browser`), a second paired
 * browser usually probes a moment after the first; give it a short grace so `--browser` can pick
 * it instead of racing the first one in.
 */
export async function waitForBrowser(bridge: Bridge, timeoutMs: number, want = 1): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let firstSeen = 0;
  for (;;) {
    const { browsers } = bridge.status();
    if (browsers.length >= want) return;
    if (browsers.length > 0) {
      firstSeen ||= Date.now();
      if (Date.now() - firstSeen > 1500) return;
    } else if (Date.now() > deadline) {
      throw new Error(
        `no browser found this session (port ${bridge.port}) within ${Math.round(timeoutMs / 1000)} s. ` +
          'Is the extension installed, paired, probing the same port range, and not paused on this session?',
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export const serveCommand: CommandModule<object, RangeArgs> = {
  command: 'serve',
  describe: 'Run only a bridge and log browsers connecting (for checking the pairing)',
  builder: (y) => y.options(rangeOptions),
  handler: (argv) => {
    void (async () => {
      const range = rangeOf(argv);
      const bridge = await listenInRange(range, {
        token: loadOrCreateToken().token,
        version: VERSION,
        label: sessionLabel('beifahrer serve'),
      });
      bridge.on('connected', (c) =>
        console.log(
          `connected: ${label(c)} — MV${c.hello.extension.manifestVersion}, ${c.hello.capabilities.length} methods`,
        ),
      );
      bridge.on('disconnected', (id) => console.log(`disconnected: ${id}`));
      console.log(
        `session "${bridge.session.label}" listening on 127.0.0.1:${bridge.port} (range ${describeRange(range)}) — Ctrl+C to stop`,
      );
    })().catch((err) => {
      console.error((err as Error).message);
      finish(1);
    });
  },
};
