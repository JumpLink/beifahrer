import { describe, expect, it } from '@gjsify/unit';

import {
  CLOSE,
  ConnectionTable,
  PROBE_STEPS_MS,
  PROTOCOL_VERSION,
  REFUSED_RETRY_MS,
  type Welcome,
} from '@beifahrer/core';

const range = { base: 47900, count: 3 };

function welcome(instance: string | null, label = `session ${instance}`): Welcome {
  return {
    type: 'welcome',
    protocol: PROTOCOL_VERSION,
    bridge: { version: '0.1.0' },
    connectionId: `c-${instance}`,
    ...(instance === null ? {} : { session: { label, pid: 1, instance, startedAt: '2026-09-25T10:00:00Z' } }),
  };
}

const OPENED = { opened: true, code: 1006, reason: '' };
const NOTHING_THERE = { opened: false, code: 1006, reason: '' };

export default async () => {
  await describe('ConnectionTable: probing', async () => {
    await it('probes every port of the range with nothing open on it', async () => {
      const t = new ConnectionTable(range);
      expect(t.due(0).join(',')).toBe('47900,47901,47902');
      t.connecting(47900);
      t.connecting(47901);
      expect(t.welcomed(47901, welcome('a'), 0)).toBe(true);
      expect(t.due(0).join(',')).toBe('47902');
    });

    await it('slows down one step per quiet round up to 5 s, and speeds up after a change', async () => {
      const t = new ConnectionTable(range);
      const delays: number[] = [];
      for (let i = 0; i < 7; i++) {
        delays.push(t.nextRoundInMs());
        t.roundDone();
      }
      expect(delays.join(',')).toBe('1000,2000,3000,4000,5000,5000,5000');
      expect(Math.max(...PROBE_STEPS_MS)).toBe(5_000);
      t.connecting(47900);
      t.welcomed(47900, welcome('a'), 0);
      expect(t.nextRoundInMs()).toBe(1_000);
      t.roundDone();
      t.roundDone();
      // A connected session going away is a change too.
      t.closed(47900, OPENED, 0);
      expect(t.nextRoundInMs()).toBe(1_000);
    });

    await it('retries a port that refused the token slowly, not every round', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.closed(47900, { opened: true, code: CLOSE.unauthorized, reason: 'wrong token' }, 1_000);
      expect(t.due(1_000).includes(47900)).toBe(false);
      expect(t.overall()).toBe('unauthorized');
      expect(t.refusalDetail('unauthorized')).toBe('wrong token');
      expect(t.due(1_000 + REFUSED_RETRY_MS).includes(47900)).toBe(true);
      t.resetRefusals();
      expect(t.due(1_001).includes(47900)).toBe(true);
    });

    await it('drops the ports that fall out of a new range', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47902);
      t.welcomed(47902, welcome('a'), 0);
      expect(t.setRange({ base: 47900, count: 2 }).join(',')).toBe('47902');
      expect(t.sessions().length).toBe(0);
      expect(t.due(0).join(',')).toBe('47900,47901');
    });
  });

  await describe('ConnectionTable: sessions', async () => {
    await it('lists connected sessions by port, with label and since', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47901);
      t.welcomed(47901, welcome('b', 'claude-code · werkstatt'), 5_000);
      t.connecting(47900);
      t.welcomed(47900, welcome(null), 7_000);
      const s = t.sessions();
      expect(s.map((x) => x.port).join(',')).toBe('47900,47901');
      expect(s[0]!.label).toBe('older bridge on port 47900');
      expect(s[1]!.label).toBe('claude-code · werkstatt');
      expect(s[1]!.since).toBe(5_000);
      expect(t.labelOf(47901)).toBe('claude-code · werkstatt');
      t.relabelled(47901, 'other · werkstatt');
      expect(t.labelOf(47901)).toBe('other · werkstatt');
      expect(t.overall()).toBe('connected');
    });

    await it('one session closing leaves the others', async () => {
      const t = new ConnectionTable(range);
      for (const [port, id] of [
        [47900, 'a'],
        [47901, 'b'],
      ] as const) {
        t.connecting(port);
        t.welcomed(port, welcome(id), 0);
      }
      t.closed(47900, OPENED, 0);
      expect(
        t
          .sessions()
          .map((x) => x.port)
          .join(','),
      ).toBe('47901');
      expect(t.overall()).toBe('connected');
      t.closed(47901, OPENED, 0);
      expect(t.overall()).toBe('offline');
    });
  });

  await describe('ConnectionTable: disconnect by the person', async () => {
    await it('dismisses the instance on that port and names it in the next hello', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.welcomed(47900, welcome('a'), 0);
      expect(t.dismiss(47900)).toBe(true);
      t.closed(47900, { opened: true, code: 1000, reason: 'disconnected by the person' }, 0);
      expect(t.dismissedInstance(47900)).toBe('a');
      // Still probed: a restarted bridge on the same port must be found.
      expect(t.due(0).includes(47900)).toBe(true);
      t.connecting(47900);
      t.closed(47900, { opened: true, code: CLOSE.dismissed, reason: '' }, 0);
      expect(t.dismissedInstance(47900)).toBe('a');
      expect(t.sessions().length).toBe(0);
    });

    await it('welcomes a NEW bridge on a dismissed port and forgets the dismissal', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.welcomed(47900, welcome('a'), 0);
      t.dismiss(47900);
      t.closed(47900, OPENED, 0);
      t.connecting(47900);
      expect(t.welcomed(47900, welcome('b'), 0)).toBe(true);
      expect(t.dismissedInstance(47900)).toBeUndefined();
    });

    await it('refuses a welcome from the dismissed instance even if the bridge let it through', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.welcomed(47900, welcome('a'), 0);
      t.dismiss(47900);
      t.closed(47900, OPENED, 0);
      t.connecting(47900);
      expect(t.welcomed(47900, welcome('a'), 0)).toBe(false);
    });

    await it('an older bridge without instance stays dismissed until nothing listens on its port', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.welcomed(47900, welcome(null), 0);
      t.dismiss(47900);
      t.closed(47900, OPENED, 0);
      t.connecting(47900);
      expect(t.welcomed(47900, welcome(null), 0)).toBe(false);
      t.closed(47900, OPENED, 0);
      t.connecting(47900);
      expect(t.welcomed(47900, welcome(null), 0)).toBe(false);
      t.closed(47900, OPENED, 0);
      // The bridge exited: the probe finds nothing, and the port is open to the next session.
      t.connecting(47900);
      t.closed(47900, NOTHING_THERE, 0);
      t.connecting(47900);
      expect(t.welcomed(47900, welcome(null), 0)).toBe(true);
    });

    await it('a dismissed bridge that exited is forgotten on the first failed probe', async () => {
      const t = new ConnectionTable(range);
      t.connecting(47900);
      t.welcomed(47900, welcome('a'), 0);
      t.dismiss(47900);
      t.closed(47900, OPENED, 0);
      t.connecting(47900);
      t.closed(47900, NOTHING_THERE, 0);
      expect(t.dismissedInstance(47900)).toBeUndefined();
    });

    await it('cannot dismiss a port without a session', async () => {
      const t = new ConnectionTable(range);
      expect(t.dismiss(47900)).toBe(false);
      t.connecting(47901);
      expect(t.dismiss(47901)).toBe(false);
    });
  });
};
