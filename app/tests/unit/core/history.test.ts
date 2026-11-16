import { describe, expect, it } from '@gjsify/unit';
import {
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_ENTRIES,
  historyEntry,
  parseHistory,
  pruneHistory,
  pushHistory,
  type HistoryEntry,
} from '@beifahrer/core';

// ADR 0029: the history is opt-in and local, and what it may hold is decided here. The whole privacy
// argument is that an entry is built from five inputs and nothing else can get in.
export default async () => {
  await describe('historyEntry', async () => {
    await it('keeps the host and drops path, query and fragment', async () => {
      const e = historyEntry({
        at: 1,
        method: 'page.read',
        url: 'https://bank.example:8443/acct/1?token=s#x',
      });
      expect(e.host).toBe('bank.example:8443');
      expect(JSON.stringify(e)).not.toContain('token');
      expect(JSON.stringify(e)).not.toContain('acct');
    });

    await it('has no host for a non-web address or none', async () => {
      expect(historyEntry({ at: 1, method: 'tabs.list' }).host).toBe(null);
      expect(historyEntry({ at: 1, method: 'page.read', url: 'about:blank' }).host).toBe(null);
    });

    await it('never carries a fill text, a script or a session label', async () => {
      const e = historyEntry({
        at: 1,
        method: 'page.fill',
        url: 'https://example.org/',
        ...({ params: { text: 'hunter2' }, session: 'claude-code · private' } as object),
      });
      expect(Object.keys(e).sort().join(',')).toBe('at,host,method,outcome');
    });

    await it('classes outcomes and keeps a clean reason only', async () => {
      expect(historyEntry({ at: 1, method: 'page.click', error: { code: 'forbidden' } }).outcome).toBe(
        'refused',
      );
      const failed = historyEntry({ at: 1, method: 'page.click', error: { code: 'timeout' } });
      expect(failed.outcome).toBe('failed');
      expect(failed.reason).toBe('timeout');
      const odd = historyEntry({ at: 1, method: 'page.click', error: { code: 'Secret text with spaces' } });
      expect(odd.reason).toBe('failed');
    });
  });

  await describe('parseHistory', async () => {
    await it('drops malformed entries and unknown methods, and cuts extra keys', async () => {
      const parsed = parseHistory([
        {
          at: 1,
          method: 'page.read',
          host: 'a.example',
          outcome: 'ok',
          url: 'https://a.example/x',
          title: 't',
        },
        { at: 'x', method: 'page.read', host: null, outcome: 'ok' },
        { at: 2, method: 'page.nope', host: null, outcome: 'ok' },
        { at: 3, method: 'page.read', host: 5, outcome: 'ok' },
        { at: 4, method: 'page.read', host: null, outcome: 'maybe' },
        null,
        'x',
      ]);
      expect(parsed.length).toBe(1);
      expect(Object.keys(parsed[0]!).sort().join(',')).toBe('at,host,method,outcome');
    });

    await it('treats anything that is not an array as empty', async () => {
      expect(parseHistory(undefined).length).toBe(0);
      expect(parseHistory({}).length).toBe(0);
    });
  });

  await describe('ring buffer', async () => {
    const e = (at: number): HistoryEntry => ({ at, method: 'page.read', host: 'a.example', outcome: 'ok' });

    await it('puts the newest first', async () => {
      const log = pushHistory(pushHistory([], e(1), 10), e(2), 10);
      expect(log.map((x) => x.at).join(',')).toBe('2,1');
    });

    await it('caps the count, dropping the oldest', async () => {
      let log: HistoryEntry[] = [];
      for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) log = pushHistory(log, e(1000 + i), 1000 + i);
      expect(log.length).toBe(HISTORY_MAX_ENTRIES);
      expect(log[0]!.at).toBe(1000 + HISTORY_MAX_ENTRIES + 4);
      expect(log[log.length - 1]!.at).toBe(1005);
    });

    await it('drops entries older than the age cap', async () => {
      const now = HISTORY_MAX_AGE_MS * 2;
      const log = pruneHistory([e(now), e(now - HISTORY_MAX_AGE_MS), e(now - HISTORY_MAX_AGE_MS - 1)], now);
      expect(log.length).toBe(2);
    });
  });
};
