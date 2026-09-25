import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { callCommand, mcpCommand, serveCommand, tokenCommand } from './frontends/cli/commands.ts';
import { VERSION } from './version.ts';

function reportError(err: unknown): void {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

const parseArgs = () =>
  yargs(hideBin(process.argv))
    .command(mcpCommand)
    .command(tokenCommand)
    .command(serveCommand)
    .command(callCommand)
    .demandCommand(1, 'Name a command — `beifahrer --help` lists them.')
    // Unknown commands must fail: on GJS an unmatched command would leave the main loop running.
    .strictCommands()
    .scriptName('beifahrer')
    .version(VERSION)
    .locale('en')
    .help()
    .fail(false)
    .exitProcess(false)
    .parseAsync();

// yargs can throw synchronously for some failures; normalise to a rejection so it is reported once.
let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs();
} catch (err) {
  parsed = Promise.reject(err);
}

const runningOnGjs = typeof (globalThis as { imports?: unknown }).imports !== 'undefined';

if (runningOnGjs) {
  // GJS has no always-on event loop: a GLib main loop keeps the bridge's sockets and the MCP stdio
  // server alive. Commands end themselves with process.exit(); this only steps in where nothing
  // else will — parse errors and yargs' own --help / --version.
  const GLib = (
    globalThis as unknown as {
      imports: { gi: { GLib: { MainLoop: new (ctx: unknown, running: boolean) => { run(): void } } } };
    }
  ).imports.gi.GLib;
  const loop = new GLib.MainLoop(null, false);
  parsed.then(
    (argv) => {
      const a = argv as Record<string, unknown> | undefined;
      if (a?.help || a?.version) process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    },
    (err) => {
      reportError(err);
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1);
    },
  );
  loop.run();
} else {
  parsed.catch(reportError);
}
