import { describe, expect, it } from '@gjsify/unit';

import {
  AUTOSAVE_PREFIX,
  addAutosave,
  autosaveName,
  defineSession,
  parseSessions,
  restorePlan,
  sessionNameError,
  sessionNameIssue,
  snapshot,
  summarizeClosed,
  summarizeSession,
  upsertSession,
  type Policy,
  type SavedSession,
} from '@beifahrer/core';

// Saved sessions hold the person's browsing. Every case below is a way they could leak to the
// agent, widen what an agent can open, or lose the window the feature exists to bring back.
export default async () => {
  const policy: Policy = { origins: { 'https://docs.example': { level: 'read' } } };
  const bank = 'https://bank.example/konto?iban=DE00';

  const session = (
    name: string,
    kind: SavedSession['kind'],
    savedAt: number,
    url = 'https://docs.example/a',
  ) => ({ name, kind, savedAt, windows: [{ tabs: [{ url, pinned: false }], groups: [] }] }) as SavedSession;

  await describe('snapshot', async () => {
    await it('keeps order, pinned state and groups; skips private, popup and non-web tabs', async () => {
      const { session: s, skipped } = snapshot(
        [
          {
            id: 1,
            type: 'normal',
            tabs: [
              { index: 2, url: 'https://docs.example/b', groupId: 7, title: 'B' },
              { index: 0, url: bank, pinned: true, title: 'Kontostand' },
              { index: 1, url: 'about:config' },
              { index: 3, url: '', pendingUrl: 'https://docs.example/c', groupId: 7 },
            ],
          },
          { id: 2, type: 'popup', tabs: [{ url: 'https://docs.example/confirm' }] },
          { id: 3, type: 'normal', incognito: true, tabs: [{ url: 'https://docs.example/private' }] },
        ],
        [{ id: 7, title: 'Docs', color: 'blue', collapsed: true }],
        { name: 'x', kind: 'saved', now: 1000 },
      );
      expect(skipped).toBe(1);
      expect(s.windows.length).toBe(1);
      const tabs = s.windows[0]!.tabs;
      expect(tabs.map((t) => t.url)).toEqualArray([bank, 'https://docs.example/b', 'https://docs.example/c']);
      expect(tabs[0]!.pinned).toBe(true);
      expect(tabs[1]!.group).toBe(0);
      expect(tabs[2]!.group).toBe(0);
      expect(s.windows[0]!.groups).toStrictEqual([{ title: 'Docs', color: 'blue', collapsed: true }]);
    });
  });

  await describe('parseSessions', async () => {
    await it('drops malformed sessions, windows and tabs one by one', async () => {
      const parsed = parseSessions([
        session('ok', 'saved', 1),
        { ...session('bad-kind', 'saved', 1), kind: 'admin' },
        { ...session('bad-time', 'saved', 1), savedAt: 'yesterday' },
        { name: 'no-web', kind: 'saved', savedAt: 1, windows: [{ tabs: [{ url: 'file:///etc/passwd' }] }] },
        {
          name: 'mixed',
          kind: 'saved',
          savedAt: 1,
          windows: [
            {
              tabs: [
                { url: 'javascript:alert(1)' },
                { url: 'https://docs.example/x', pinned: 'yes', group: 5 },
              ],
            },
          ],
        },
        session('ok', 'saved', 2),
        null,
        42,
      ]);
      expect(parsed.map((s) => s.name)).toEqualArray(['ok', 'mixed']);
      expect(parsed[0]!.savedAt).toBe(1);
      const tab = parsed[1]!.windows[0]!.tabs;
      expect(tab.length).toBe(1);
      // Not a literal true: not pinned. A group index past the window's groups: dropped.
      expect(tab[0]!.pinned).toBe(false);
      expect(tab[0]!.group).toBeUndefined();
    });
    await it('yields nothing for garbage', async () => {
      for (const raw of [null, {}, 'x', 1]) expect(parseSessions(raw).length).toBe(0);
    });
  });

  await describe('sessionNameError', async () => {
    await it('refuses empty, padded, control-character and autosave names', async () => {
      expect(sessionNameError('Steuern 2025')).toBeNull();
      for (const bad of ['', ' x', 'x ', 'a\nb', 'x'.repeat(101), 42, `${AUTOSAVE_PREFIX}1`])
        expect(sessionNameError(bad)).not.toBeNull();
      expect(sessionNameError(`${AUTOSAVE_PREFIX}1`, { allowAutosave: true })).toBeNull();
    });

    await it('names each refusal with a code the options page can word', async () => {
      const cases: [unknown, string][] = [
        [42, 'type'],
        ['', 'empty'],
        [' x', 'whitespace'],
        ['x'.repeat(101), 'length'],
        ['a\nb', 'control'],
        [`${AUTOSAVE_PREFIX}1`, 'reserved'],
      ];
      for (const [name, code] of cases) expect(sessionNameIssue(name)).toBe(code);
      expect(sessionNameIssue('Steuern 2025')).toBeNull();
    });
  });

  await describe('summarizeSession', async () => {
    await it('shows a saved tab below read as its host only', async () => {
      const s: SavedSession = {
        name: 'w',
        kind: 'saved',
        savedAt: 0,
        windows: [
          {
            tabs: [
              { url: bank, title: 'Kontostand 1.234 €', pinned: true },
              { url: 'https://docs.example/a', title: 'A', pinned: false },
            ],
            groups: [],
          },
        ],
      };
      const summary = summarizeSession(s, policy, true);
      expect(summary.tabCount).toBe(2);
      const [hidden, shown] = summary.windows![0]!.tabs;
      expect(hidden!.host).toBe('bank.example');
      expect(hidden!.url).toBeUndefined();
      expect(hidden!.title).toBeUndefined();
      expect(hidden!.pinned).toBe(true);
      expect(JSON.stringify(summary).includes('iban')).toBe(false);
      expect(JSON.stringify(summary).includes('Kontostand')).toBe(false);
      expect(shown!.url).toBe('https://docs.example/a');
    });
    await it('gives counts only when tabs are not asked for', async () => {
      expect(summarizeSession(session('a', 'auto', 0), policy, false).windows).toBeUndefined();
    });
  });

  await describe('defineSession', async () => {
    await it('needs read on every URL the agent puts in', async () => {
      const r = defineSession(
        {
          name: 'task',
          windows: [{ tabs: [{ url: 'https://docs.example/a' }, { url: 'https://evil.example/?q=s' }] }],
        },
        policy,
        5,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('forbidden');
        expect(r.origin).toBe('https://evil.example');
      }
    });
    await it('refuses non-web URLs, empty windows and bad names', async () => {
      for (const raw of [
        { name: 'x', windows: [{ tabs: [{ url: 'file:///etc/passwd' }] }] },
        { name: 'x', windows: [{ tabs: [] }] },
        { name: 'x', windows: [] },
        { name: `${AUTOSAVE_PREFIX}x`, windows: [{ tabs: [{ url: 'https://docs.example/' }] }] },
        null,
      ])
        expect(defineSession(raw, policy, 0).ok).toBe(false);
    });
    await it('builds an agent session with pinned tabs first', async () => {
      const r = defineSession(
        {
          name: 'task',
          windows: [
            { tabs: [{ url: 'https://docs.example/a' }, { url: 'https://docs.example/b', pinned: true }] },
          ],
        },
        policy,
        5,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.session.kind).toBe('agent');
        expect(r.session.windows[0]!.tabs.map((t) => t.url)).toEqualArray([
          'https://docs.example/b',
          'https://docs.example/a',
        ]);
      }
    });
  });

  await describe('restorePlan', async () => {
    await it("restores the person's own below-read tabs", async () => {
      const plan = restorePlan(session('mine', 'saved', 0, bank), policy);
      expect(plan.windows[0]!.tabs[0]!.url).toBe(bank);
      expect(plan.skipped).toBe(0);
    });
    await it('rechecks an agent session against the policy as it is now', async () => {
      const agent: SavedSession = {
        name: 'task',
        kind: 'agent',
        savedAt: 0,
        windows: [
          {
            tabs: [
              { url: 'https://docs.example/a', pinned: false },
              { url: 'https://lowered.example/', pinned: false },
            ],
            groups: [],
          },
        ],
      };
      const plan = restorePlan(agent, policy);
      expect(plan.skipped).toBe(1);
      expect(plan.windows[0]!.tabs.map((t) => t.url)).toEqualArray(['https://docs.example/a']);
      expect(restorePlan(agent, { origins: {} }).windows.length).toBe(0);
    });
  });

  await describe('addAutosave', async () => {
    await it('keeps the newest N and never touches named sessions', async () => {
      let all: SavedSession[] = [session('work', 'saved', 0)];
      for (let i = 1; i <= 5; i++)
        all = addAutosave(
          all,
          session(autosaveName(i * 1000), 'auto', i * 1000, `https://docs.example/${i}`),
          3,
        )!;
      expect(all.filter((s) => s.kind === 'auto').map((s) => s.savedAt)).toEqualArray([3000, 4000, 5000]);
      expect(all.some((s) => s.name === 'work')).toBe(true);
    });
    await it('skips a snapshot identical to the newest, so idling does not rotate history out', async () => {
      const all = [session(autosaveName(1000), 'auto', 1000)];
      expect(addAutosave(all, session(autosaveName(2000), 'auto', 2000))).toBeNull();
    });
    await it('never stores an empty snapshot', async () => {
      const empty: SavedSession = { name: autosaveName(1), kind: 'auto', savedAt: 1, windows: [] };
      expect(addAutosave([], empty)).toBeNull();
    });
    await it('upsert replaces by name', async () => {
      const next = upsertSession([session('a', 'saved', 1)], session('a', 'saved', 2));
      expect(next.length).toBe(1);
      expect(next[0]!.savedAt).toBe(2);
    });
  });

  await describe('summarizeClosed', async () => {
    await it('redacts closed tabs, skips popups and private windows, normalises the time', async () => {
      const out = summarizeClosed(
        [
          {
            lastModified: 1_758_000_000,
            window: { sessionId: 'w1', type: 'normal', tabs: [{ url: bank, title: 'Kontostand' }] },
          },
          { lastModified: 1_758_000_000_000, window: { sessionId: 'w2', type: 'popup', tabs: [] } },
          { window: { sessionId: 'w3', incognito: true, tabs: [] } },
          {
            lastModified: 1_758_000_000_000,
            tab: { sessionId: 't1', url: 'https://docs.example/a', title: 'A' },
          },
          { tab: { url: 'https://docs.example/no-id' } },
        ],
        policy,
      );
      expect(out.map((c) => c.sessionId)).toEqualArray(['w1', 't1']);
      expect(out[0]!.closedAt).toBe(out[1]!.closedAt);
      expect(out[0]!.tabs[0]!.url).toBeUndefined();
      expect(JSON.stringify(out).includes('Kontostand')).toBe(false);
      expect(out[1]!.tabs[0]!.title).toBe('A');
    });
  });
};
