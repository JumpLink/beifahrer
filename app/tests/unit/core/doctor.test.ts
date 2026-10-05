import { describe, expect, it } from '@gjsify/unit';

import { diagnose, exitCodeOf, statusOf, type DoctorInput, type RegistryEntry } from '@beifahrer/core';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const session = (port: number, browsers = 0): RegistryEntry => ({
  v: 1,
  instance: `i-${port}`,
  label: `agent-${port}`,
  pid: 1,
  port,
  startedAt: '2026-10-05T11:00:00.000Z',
  updatedAt: NOW.toISOString(),
  bridgeVersion: '0.1.4',
  browsers: Array.from({ length: browsers }, (_, i) => ({
    id: `b${i}`,
    family: 'firefox' as const,
    name: 'Firefox',
    version: '155.0',
    extensionVersion: '0.1.4',
    connectedAt: '2026-10-05T11:05:00.000Z',
  })),
});

const input = (over: Partial<DoctorInput> & { sessions?: RegistryEntry[] } = {}): DoctorInput => {
  const { sessions = [], ...rest } = over;
  return {
    version: '0.1.4',
    runtime: 'GJS',
    range: { base: 47813, count: 10 },
    listening: sessions.map((s) => s.port),
    status: statusOf(sessions, NOW),
    skipped: 0,
    token: { path: '/c/beifahrer/token', exists: true, other: null },
    ...rest,
  };
};
const byId = (checks: ReturnType<typeof diagnose>, id: string) => checks.find((c) => c.id === id);

// Each finding is one cause and one thing to do. A check that only says "not ok" is the failure this
// command exists to end (a stale bridge held a port for hours and nothing named it).
export default async () => {
  await describe('doctor', async () => {
    await it('is all ok, with the version first, when a session and a browser are there', async () => {
      const checks = diagnose(input({ sessions: [session(47813, 1)] }));
      expect(checks[0]!.title).toBe('Beifahrer 0.1.4 on GJS');
      expect(checks.every((c) => c.level === 'ok')).toBe(true);
      expect(byId(checks, 'sessions')!.title).toBe('1 agent session running, 1 browser connected');
      expect(byId(checks, 'ports')!.title).toBe('9 of 10 ports in 47813–47822 free for a new session');
      expect(exitCodeOf(checks)).toBe(0);
    });

    await it('warns, with a next step, when no session runs; and that alone does not fail', async () => {
      const checks = diagnose(input());
      const s = byId(checks, 'sessions')!;
      expect(s.level).toBe('warn');
      expect(s.fix).toMatch(/beifahrer config <agent>/);
      expect(exitCodeOf(checks)).toBe(0);
    });

    await it('tells a session without a browser to check the token and wait', async () => {
      const s = byId(diagnose(input({ sessions: [session(47813, 0)] })), 'sessions')!;
      expect(s.level).toBe('warn');
      expect(s.title).toMatch(/1 agent session is running, but no browser is connected to it/);
      expect(s.fix).toMatch(/pairing token/);
    });

    await it('FAILS when every port of the range is taken', async () => {
      const checks = diagnose(input({ range: { base: 47813, count: 2 }, listening: [47813, 47814] }));
      const p = byId(checks, 'ports')!;
      expect(p.level).toBe('fail');
      expect(p.title).toMatch(/Every port of 127\.0\.0\.1:47813–47814 is taken/);
      expect(p.fix).toMatch(/BEIFAHRER_PORT_COUNT/);
      expect(exitCodeOf(checks)).toBe(1);
    });

    await it('names a port that answers without a session, and what that may be', async () => {
      const c = byId(
        diagnose(input({ sessions: [session(47814, 1)], listening: [47813, 47814] })),
        'listeners',
      )!;
      expect(c.level).toBe('warn');
      expect(c.title).toBe('Port 47813 answers, but no running session announced it');
      expect(c.fix).toMatch(/restart the agent session/);
      expect(byId(diagnose(input({ listening: [47813, 47815] })), 'listeners')!.title).toBe(
        'Ports 47813, 47815 answer, but no running session announced them',
      );
      expect(byId(diagnose(input({ sessions: [session(47813, 1)] })), 'listeners')).toBe(undefined);
    });

    await it('asks for a token when there is none, and says where it would be', async () => {
      const t = byId(diagnose(input({ token: { path: '/c/token', exists: false, other: null } })), 'token')!;
      expect(t.level).toBe('warn');
      expect(t.title).toBe('No pairing token yet (/c/token)');
      expect(t.fix).toMatch(/beifahrer token/);
    });

    await it('names a second token file with another token, and never carries a token', async () => {
      const checks = diagnose(
        input({ token: { path: '/a', exists: true, other: '/home/p/.config/beifahrer/token' } }),
      );
      const t = byId(checks, 'token')!;
      expect(t.level).toBe('warn');
      expect(t.title).toMatch(/\/home\/p\/\.config\/beifahrer\/token/);
      expect(Object.keys(t).sort().join()).toBe('fix,id,level,title');
    });

    await it('counts registry files it could not read, and says nothing when there are none', async () => {
      expect(byId(diagnose(input({ skipped: 2 })), 'registry')!.title).toBe(
        '2 files in the registry could not be read',
      );
      expect(byId(diagnose(input()), 'registry')).toBe(undefined);
    });
  });
};
