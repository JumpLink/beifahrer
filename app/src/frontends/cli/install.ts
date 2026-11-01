/**
 * What the running process says about where Beifahrer is installed, so `beifahrer config` writes the
 * command that works on this host (the decision itself is `serverSpec` in core) and `beifahrer doctor`
 * can check the commands already in an agent's config. Reads only; nothing is written.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  AGENTS,
  commandInConfig,
  launcherOf,
  userConfigPath,
  type AgentCommand,
  type Install,
} from '@beifahrer/core';

type Env = Record<string, string | undefined>;

export function detectInstall(
  platform: string = process.platform,
  execPath: string = process.execPath,
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): Install {
  const flatpak = exists('/.flatpak-info') || Boolean(env['FLATPAK_ID']);
  const guess = launcherOf(platform, execPath);
  return { platform, flatpak, launcher: guess && exists(guess) ? guess : undefined };
}

/** `~` and `%VAR%` in a path from the agents table. */
export function expandPath(path: string, env: Env = process.env, home: string = homedir()): string {
  return path.replace(/^~(?=[/\\]|$)/, home).replace(/%(\w+)%/g, (whole, name: string) => env[name] ?? whole);
}

export function resolvesOnHost(
  command: string,
  platform: string = process.platform,
  env: Env = process.env,
): boolean {
  const isFile = (p: string) => {
    try {
      if (!statSync(p).isFile()) return false;
      if (platform !== 'win32') accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(command) || /^[A-Za-z]:[\\/]/.test(command)) return isFile(command);
  const exts =
    platform === 'win32' ? ['', ...(env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  return (env['PATH'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((ext) => isFile(join(dir, command + ext))));
}

/** The command each existing user-level agent config starts Beifahrer with. Missing files are skipped. */
export function agentCommands(platform: string = process.platform, env: Env = process.env): AgentCommand[] {
  const found: AgentCommand[] = [];
  for (const agent of AGENTS) {
    const path = userConfigPath(agent, platform);
    if (!path) continue;
    const file = expandPath(path, env);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const command = commandInConfig(agent, text);
    if (command)
      found.push({ agent: agent.name, file, command, resolves: resolvesOnHost(command, platform, env) });
  }
  return found;
}
