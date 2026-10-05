/**
 * `beifahrer doctor`: what stands between a person and "the agent can use my browser", one finding
 * per cause with the one thing to do about it. Pure: the caller passes in what it measured (a port
 * probe, the registry, the token file's state), so every wording and every rung is tested without
 * a socket or a file.
 *
 * It reads the same things `status` does and adds the two a registry cannot know: whether the range
 * has a free port left and whether a token exists that a browser could have been paired with. It
 * never says whether a browser is paused; the bridge does not know (ADR 0015 §5).
 */

import { describeRange, portsOf, type PortRange } from './ports.ts';
import { unregisteredPorts, type RegistryStatus } from './registry.ts';

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface Check {
  id: 'version' | 'ports' | 'listeners' | 'token' | 'sessions' | 'registry';
  level: CheckLevel;
  /** What was found, one line. */
  title: string;
  /** What to do about it. Absent when there is nothing to do. */
  fix?: string;
}

export interface DoctorInput {
  version: string;
  /** "GJS", "Node.js 24.21.0". */
  runtime: string;
  range: PortRange;
  /** The ports of the range that answered a TCP connect. */
  listening: readonly number[];
  status: RegistryStatus;
  /** Registry files that were not entries. */
  skipped: number;
  token: { path: string; exists: boolean; other: string | null };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function diagnose(input: DoctorInput): Check[] {
  const { range, listening, status, token } = input;
  const checks: Check[] = [
    { id: 'version', level: 'ok', title: `Beifahrer ${input.version} on ${input.runtime}` },
  ];

  const free = portsOf(range).filter((p) => !listening.includes(p));
  const where = describeRange(range);
  checks.push(
    free.length === 0
      ? {
          id: 'ports',
          level: 'fail',
          title: `Every port of 127.0.0.1:${where} is taken, so no new agent session can start`,
          fix: 'End a session you no longer need, or widen the range: BEIFAHRER_PORT_COUNT for the bridge and "Ports" in the extension options, the same number on both sides.',
        }
      : {
          id: 'ports',
          level: 'ok',
          title: `${free.length} of ${plural(range.count, 'port', 'ports')} in ${where} free for a new session`,
        },
  );

  const strangers = unregisteredPorts(listening, status.sessions);
  if (strangers.length > 0) {
    checks.push({
      id: 'listeners',
      level: 'warn',
      title: `${strangers.length === 1 ? 'Port' : 'Ports'} ${strangers.join(', ')} answer${strangers.length === 1 ? 's' : ''}, but no running session announced ${strangers.length === 1 ? 'it' : 'them'}`,
      fix: 'An older Beifahrer, a bridge that no longer answers, or another program. A browser tries these ports like any other. If it is a Beifahrer, restart the agent session that started it.',
    });
  }

  if (!token.exists) {
    checks.push({
      id: 'token',
      level: 'warn',
      title: `No pairing token yet (${token.path})`,
      fix: 'Run `beifahrer token` and paste what it prints into the extension options of each browser.',
    });
  } else if (token.other) {
    checks.push({
      id: 'token',
      level: 'warn',
      title: `A second token file holds a different token: ${token.other}`,
      fix: 'A browser paired with that one cannot connect. Paste the token from `beifahrer token` instead; an older Beifahrer that is still running may read the other file until it is restarted.',
    });
  } else {
    checks.push({ id: 'token', level: 'ok', title: `Pairing token in ${token.path}` });
  }

  const sessions = status.sessions.length;
  if (status.presence === 'no-bridge') {
    checks.push({
      id: 'sessions',
      level: 'warn',
      title: 'No agent session is running, so no agent can use a browser',
      fix: 'Start an agent that has Beifahrer set up (`beifahrer config <agent>` prints how).',
    });
  } else if (status.presence === 'no-browser') {
    checks.push({
      id: 'sessions',
      level: 'warn',
      title: `${plural(sessions, 'agent session is', 'agent sessions are')} running, but no browser is connected to ${sessions === 1 ? 'it' : 'any'}`,
      fix: 'Open the browser with the extension, check that its pairing token is the one above, and give it a few seconds: the extension looks for a bridge every few seconds.',
    });
  } else {
    const browsers = status.sessions.reduce((n, s) => n + s.browsers.length, 0);
    checks.push({
      id: 'sessions',
      level: 'ok',
      title: `${plural(sessions, 'agent session', 'agent sessions')} running, ${plural(browsers, 'browser', 'browsers')} connected`,
    });
  }

  if (input.skipped > 0) {
    checks.push({
      id: 'registry',
      level: 'warn',
      title: `${plural(input.skipped, 'file', 'files')} in the registry could not be read`,
      fix: 'They are ignored. Delete them if they stay.',
    });
  }
  return checks;
}

/** The exit code `doctor` ends with: 1 when something is broken, 0 for ok and for warnings. */
export function exitCodeOf(checks: readonly Check[]): 0 | 1 {
  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}
