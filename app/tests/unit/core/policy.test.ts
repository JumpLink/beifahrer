import { describe, expect, it } from '@gjsify/unit';

import {
  EMPTY_POLICY,
  MAX_GRANT_MS,
  accessFor,
  decide,
  hostsToRelease,
  levelFor,
  nextExpiry,
  originOf,
  parseGrants,
  parsePolicy,
  pruneGrants,
  wildcardGrant,
  withWildcardQuiet,
  withRule,
  withRuleQuiet,
  withoutRule,
  type Grant,
  type Policy,
} from '@beifahrer/core';

// The policy is the product's safety claim. Every case below is a way it could fail OPEN.
export default async () => {
  const policy: Policy = {
    origins: {
      'https://tracker.example': { level: 'write' },
      'https://quiet.example': { level: 'write', confirmWrites: false },
      'https://bank.example': { level: 'read' },
    },
  };

  await describe('originOf', async () => {
    await it('keeps scheme, host and non-default port, drops path and query', async () => {
      expect(originOf('https://tracker.example/projects/1?x=2#y')).toBe('https://tracker.example');
      expect(originOf('http://localhost:3000/a')).toBe('http://localhost:3000');
    });
    await it('gives browser-internal, local and extension pages no origin', async () => {
      for (const url of [
        'about:blank',
        'chrome://settings',
        'file:///etc/passwd',
        'moz-extension://abc/x.html',
        'data:text/html,hi',
        '',
      ]) {
        expect(originOf(url)).toBeNull();
      }
      expect(originOf(undefined)).toBeNull();
      expect(originOf('not a url')).toBeNull();
    });
  });

  await describe('levelFor', async () => {
    await it('is none for an origin nobody configured', async () => {
      expect(levelFor(policy, 'https://elsewhere.example/')).toBe('none');
    });
    await it('does not leak a level to a sibling subdomain or another port', async () => {
      expect(levelFor(policy, 'https://evil.tracker.example/')).toBe('none');
      expect(levelFor(policy, 'https://tracker.example:8443/')).toBe('none');
      expect(levelFor(policy, 'http://tracker.example/')).toBe('none');
    });
  });

  await describe('decide', async () => {
    await it('lets listing tabs through without a level', async () => {
      expect(decide(EMPTY_POLICY, 'tabs.list', undefined)).toStrictEqual({ allow: true, confirm: false });
    });
    await it('refuses a read below read, naming what is missing', async () => {
      expect(decide(policy, 'page.read', 'https://elsewhere.example/x')).toStrictEqual({
        allow: false,
        origin: 'https://elsewhere.example',
        have: 'none',
        need: 'read',
        askable: true,
      });
    });
    await it('refuses a write on a read-only site', async () => {
      const d = decide(policy, 'page.fill', 'https://bank.example/inbox');
      expect(d.allow).toBe(false);
    });
    await it('asks before a write unless the site switched it off', async () => {
      expect(decide(policy, 'page.fill', 'https://tracker.example/wp/1')).toStrictEqual({
        allow: true,
        confirm: true,
      });
      expect(decide(policy, 'page.click', 'https://quiet.example/')).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('never confirms a read', async () => {
      expect(decide(policy, 'page.read', 'https://tracker.example/')).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('needs read on the TARGET to open a URL', async () => {
      expect(decide(policy, 'tabs.open', 'https://attacker.example/?q=secret').allow).toBe(false);
      expect(decide(policy, 'tabs.open', 'https://bank.example/').allow).toBe(true);
    });
    await it('refuses page methods on a non-web page even with a policy for it', async () => {
      expect(decide(policy, 'page.read', 'file:///home/me/notes.txt').allow).toBe(false);
    });
  });

  await describe('tab management and sessions', async () => {
    await it('still needs read on every NEW URL a window or workspace opens', async () => {
      expect(decide(policy, 'windows.create', 'https://attacker.example/?q=1').allow).toBe(false);
      expect(decide(policy, 'sessions.define', 'https://bank.example/').allow).toBe(true);
    });
  });

  await describe('withRule / withoutRule', async () => {
    await it('keeps none as an explicit block', async () => {
      const next = withRule(policy, 'https://bank.example', { level: 'none' });
      expect(next.origins['https://bank.example']?.level).toBe('none');
      expect(policy.origins['https://bank.example']?.level).toBe('read');
    });
    await it('withoutRule forgets the site, so the default applies', async () => {
      const next = withoutRule(policy, 'https://bank.example');
      expect(Object.keys(next.origins).includes('https://bank.example')).toBe(false);
      expect(Object.keys(policy.origins).includes('https://bank.example')).toBe(true);
    });
    await it('withRuleQuiet drops a stored false when asking goes back on, and keeps the other', async () => {
      const rule = { level: 'write', confirmWrites: false, confirmScripts: false } as const;
      const askScripts = withRuleQuiet(rule, 'confirmScripts', true);
      expect('confirmScripts' in askScripts).toBe(false);
      expect(askScripts.confirmWrites).toBe(false);
      expect(askScripts.level).toBe('write');
      const askWrites = withRuleQuiet(rule, 'confirmWrites', true);
      expect('confirmWrites' in askWrites).toBe(false);
      expect(askWrites.confirmScripts).toBe(false);
      // Switching asking OFF stores exactly `false`, and touches no other field.
      const quiet = withRuleQuiet({ level: 'write', confirmScripts: false }, 'confirmWrites', false);
      expect(quiet).toStrictEqual({ level: 'write', confirmWrites: false, confirmScripts: false });
      expect(rule).toStrictEqual({ level: 'write', confirmWrites: false, confirmScripts: false });
    });
  });

  // Temporary grants (ADR 0010). Each case is a way "all sites for an hour" could fail open.
  const NOW = 1_000_000;
  const HOUR = 3_600_000;
  const withGrants = (grants: Grant[]): Policy => ({
    origins: { ...policy.origins, 'https://blocked.example': { level: 'none' } },
    grants,
  });
  const at = (now = NOW, session?: string) => (session ? { now, session } : { now });

  await describe('grants: the wildcard', async () => {
    const wide = withGrants([{ scope: '*', level: 'read', until: NOW + HOUR }]);
    await it('opens every site without a rule, until it runs out', async () => {
      expect(decide(wide, 'page.read', 'https://elsewhere.example/', at()).allow).toBe(true);
      expect(decide(wide, 'page.read', 'https://elsewhere.example/', at(NOW + HOUR - 1)).allow).toBe(true);
    });
    await it('is gone at its end, checked at decision time', async () => {
      expect(decide(wide, 'page.read', 'https://elsewhere.example/', at(NOW + HOUR)).allow).toBe(false);
      expect(decide(wide, 'page.read', 'https://elsewhere.example/', at(NOW + 2 * HOUR)).allow).toBe(false);
    });
    await it('does not apply without an access context', async () => {
      expect(decide(wide, 'page.read', 'https://elsewhere.example/').allow).toBe(false);
      expect(levelFor(wide, 'https://elsewhere.example/')).toBe('none');
    });
    await it('never reaches a site the person set to none, and offers no prompt there', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      expect(decide(writeAll, 'page.read', 'https://blocked.example/', at())).toStrictEqual({
        allow: false,
        origin: 'https://blocked.example',
        have: 'none',
        need: 'read',
        askable: false,
      });
    });
    await it('does not override an explicit rule', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      expect(decide(writeAll, 'page.fill', 'https://bank.example/', at()).allow).toBe(false);
      expect(accessFor(writeAll, 'https://bank.example/', at()).source).toBe('rule');
    });
    await it('confirms every write under it while the person left asking on', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      expect(decide(writeAll, 'page.fill', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
      expect(decide(writeAll, 'page.click', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('keeps a quiet explicit write rule quiet', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      expect(decide(writeAll, 'page.click', 'https://quiet.example/', at()).allow).toBe(true);
      expect(decide(writeAll, 'page.click', 'https://quiet.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('keeps a quiet explicit write rule quiet — but not for a script', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      expect(decide(writeAll, 'page.click', 'https://quiet.example/', at()).allow).toBe(true);
      expect(decide(writeAll, 'page.click', 'https://quiet.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
      // ADR 0012: "don't ask me again on this site" is an answer about fills and clicks. It must
      // not become standing permission for code the person has not read yet.
      expect(decide(writeAll, 'page.evaluate', 'https://quiet.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('a script needs write like any write — read is never enough', async () => {
      const readAll = withGrants([{ scope: '*', level: 'read' }]);
      expect(decide(readAll, 'page.evaluate', 'https://elsewhere.example/', at()).allow).toBe(false);
      expect(decide(readAll, 'page.evaluate', 'https://elsewhere.example/', at())).toMatchObject({
        need: 'write',
        askable: true,
      });
    });
    await it('still gives a non-web page no origin', async () => {
      const writeAll = withGrants([{ scope: '*', level: 'write' }]);
      const d = decide(writeAll, 'page.read', 'file:///etc/passwd', at());
      expect(d.allow).toBe(false);
      expect(d.allow === false && d.askable).toBe(false);
    });
    await it('a read wildcard does not allow writes', async () => {
      expect(decide(wide, 'page.fill', 'https://elsewhere.example/', at()).allow).toBe(false);
    });
  });

  // The one thing a grant may be quiet about, and only because the person said so in the popup.
  await describe('grants: "all sites" without asking', async () => {
    const quiet = withGrants([{ scope: '*', level: 'write', confirmWrites: false }]);
    await it('does not ask before the writes it allows', async () => {
      for (const method of ['page.fill', 'page.click', 'page.press', 'page.select', 'page.check'] as const) {
        expect(decide(quiet, method, 'https://elsewhere.example/form', at())).toStrictEqual({
          allow: true,
          confirm: false,
        });
      }
      expect(decide(quiet, 'page.read', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('still asks for a script — confirmWrites outranks no script switch (ADR 0016)', async () => {
      expect(decide(quiet, 'page.evaluate', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('ends with the grant it belongs to', async () => {
      // No `until` on this one: it runs until the browser closes, so an hour later it is still quiet.
      expect(decide(quiet, 'page.fill', 'https://elsewhere.example/', at(NOW + HOUR))).toStrictEqual({
        allow: true,
        confirm: false,
      });
      const hour = withGrants([{ scope: '*', level: 'write', until: NOW + HOUR, confirmWrites: false }]);
      expect(decide(hour, 'page.fill', 'https://elsewhere.example/', at(NOW + HOUR - 1))).toStrictEqual({
        allow: true,
        confirm: false,
      });
      expect(decide(hour, 'page.fill', 'https://elsewhere.example/', at(NOW + HOUR)).allow).toBe(false);
    });
    await it('never quiets another session, and never a site with its own rule', async () => {
      // A grant bound to conn-a is none of conn-b's business, so conn-b still asks.
      const mine = withGrants([{ scope: '*', level: 'write', sessionId: 'conn-a', confirmWrites: false }]);
      expect(decide(mine, 'page.fill', 'https://elsewhere.example/', at(NOW, 'conn-a'))).toStrictEqual({
        allow: true,
        confirm: false,
      });
      expect(decide(mine, 'page.fill', 'https://elsewhere.example/', at(NOW, 'conn-b')).allow).toBe(false);
      expect(decide(mine, 'page.fill', 'https://elsewhere.example/', at()).allow).toBe(false);
      // The site's own rule is what decides a site that has one, quiet or not.
      expect(decide(quiet, 'page.click', 'https://quiet.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
      expect(decide(quiet, 'page.click', 'https://tracker.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
      expect(decide(quiet, 'page.click', 'https://blocked.example/', at()).allow).toBe(false);
    });
    await it('asks when the stored value is not a plain false', async () => {
      for (const stored of [0, 1, 'false', null, [], true, {}]) {
        const grants = parseGrants([{ scope: '*', level: 'write', confirmWrites: stored }], NOW);
        expect(grants[0]?.confirmWrites).toBeUndefined();
        expect(decide(withGrants(grants), 'page.fill', 'https://elsewhere.example/', at())).toStrictEqual({
          allow: true,
          confirm: true,
        });
      }
      const kept = parseGrants([{ scope: '*', level: 'write', confirmWrites: false }], NOW);
      expect(kept[0]?.confirmWrites).toBe(false);
    });
    await it('is honoured for the wildcard alone, never for a grant of one origin', async () => {
      // "For this session" on one site is the answer to a prompt, and a prompt is not a licence to
      // write there silently — even if the field somehow arrives on such a grant.
      const answered = withGrants([
        { scope: 'https://elsewhere.example', level: 'write', confirmWrites: false },
      ]);
      expect(decide(answered, 'page.fill', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
      // A wildcard bound to another session must not speak for this one, even when it is the only
      // grant here: without a live grant of its own there is no write at all, let alone a quiet one.
      const theirs = withGrants([{ scope: '*', level: 'write', sessionId: 'conn-b', confirmWrites: false }]);
      expect(decide(theirs, 'page.fill', 'https://elsewhere.example/', at(NOW, 'conn-a')).allow).toBe(false);
      expect(decide(theirs, 'page.fill', 'https://elsewhere.example/', at(NOW, 'conn-b'))).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it("wildcardGrant with a context counts only that session's grant", async () => {
      const both = [
        { scope: '*', level: 'read', until: NOW + HOUR, sessionId: 'conn-b', confirmWrites: false },
        { scope: '*', level: 'write', sessionId: 'conn-a' },
      ] as Grant[];
      expect(wildcardGrant(both, NOW, at(NOW, 'conn-a'))?.sessionId).toBe('conn-a');
      expect(wildcardGrant(both, NOW, at(NOW, 'conn-b'))?.sessionId).toBe('conn-b');
      // Without a context the caller wants any live wildcard, and one without an end beats any:
      // the pick is the same one the toolbar and the popup show.
      expect(wildcardGrant(both, NOW)?.sessionId).toBe('conn-a');
    });
    await it('withWildcardQuiet(true) removes a stored false, so switching asking back on asks', async () => {
      const quiet = [{ scope: '*', level: 'write', confirmWrites: false }] as Grant[];
      const back = withWildcardQuiet(quiet, { confirmWrites: true, confirmScripts: true });
      expect('confirmWrites' in back[0]!).toBe(false);
      expect(decide(withGrants(back), 'page.fill', 'https://a.example/', at(NOW, 'conn-a'))).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('withWildcardQuiet(false) quiets every wildcard and touches no other scope', async () => {
      const grants = [
        { scope: '*', level: 'write', sessionId: 'conn-a' },
        { scope: '*', level: 'write' },
        { scope: 'https://a.example', level: 'write' },
      ] as Grant[];
      const out = withWildcardQuiet(grants, { confirmWrites: false, confirmScripts: false });
      expect(out[0]!.confirmWrites).toBe(false);
      expect(out[0]!.confirmScripts).toBe(false);
      expect(out[1]!.confirmWrites).toBe(false);
      expect(out[1]!.confirmScripts).toBe(false);
      expect('confirmWrites' in out[2]!).toBe(false);
      expect('confirmScripts' in out[2]!).toBe(false);
    });
    await it('withWildcardQuiet moves each switch on its own, and removes the one turned back on', async () => {
      const grants = [{ scope: '*', level: 'write', confirmWrites: false, confirmScripts: false }] as Grant[];
      // Writes quiet, scripts asking again: the stored false for scripts is gone, writes stay off.
      const onlyWrites = withWildcardQuiet(grants, { confirmWrites: false, confirmScripts: true });
      expect(onlyWrites[0]!.confirmWrites).toBe(false);
      expect('confirmScripts' in onlyWrites[0]!).toBe(false);
      // The other way round, and the other field of the grant is never invented.
      const onlyScripts = withWildcardQuiet(grants, { confirmWrites: true, confirmScripts: false });
      expect('confirmWrites' in onlyScripts[0]!).toBe(false);
      expect(onlyScripts[0]!.confirmScripts).toBe(false);
      // Both asking again: nothing stored at all.
      const asked = withWildcardQuiet(grants, { confirmWrites: true, confirmScripts: true });
      expect('confirmWrites' in asked[0]!).toBe(false);
      expect('confirmScripts' in asked[0]!).toBe(false);
      expect(decide(withGrants(asked), 'page.evaluate', 'https://a.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
  });

  // The person's own switch for scripts, kept apart from the one for writes (ADR 0016). Every case
  // below is a way one of the two could silence the other, or a way asking could stop being the
  // default.
  await describe('scripts without asking', async () => {
    const write = { origins: { 'https://shop.example': { level: 'write' as const } } };
    await it('asks for a script on a site the person said nothing about', async () => {
      expect(decide(write, 'page.evaluate', 'https://shop.example/x', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('confirmScripts: false on the site stops the window for scripts alone', async () => {
      const quiet: Policy = {
        origins: { 'https://shop.example': { level: 'write', confirmScripts: false } },
      };
      expect(decide(quiet, 'page.evaluate', 'https://shop.example/x', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
      // …and says nothing about the ordinary writes, which still go through confirmWrites.
      expect(decide(quiet, 'page.click', 'https://shop.example/x', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('confirmWrites: false stops the window for writes alone', async () => {
      const quiet: Policy = {
        origins: { 'https://shop.example': { level: 'write', confirmWrites: false } },
      };
      expect(decide(quiet, 'page.fill', 'https://shop.example/x', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
      // A script is still shown in full: "don't ask me before you change this form" is not an
      // answer about code the person has never read (ADR 0012).
      expect(decide(quiet, 'page.evaluate', 'https://shop.example/x', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('the two switches are independent in every combination', async () => {
      const cases: [boolean | undefined, boolean | undefined, boolean][] = [
        // [confirmWrites, confirmScripts, does the script ask]
        [undefined, undefined, true],
        [false, undefined, true],
        [undefined, false, false],
        [false, false, false],
        [true, false, false],
        [false, true, true],
        [true, true, true],
      ];
      for (const [writes, scripts, asks] of cases) {
        const p: Policy = {
          origins: {
            'https://shop.example': {
              level: 'write',
              ...(writes === undefined ? {} : { confirmWrites: writes }),
              ...(scripts === undefined ? {} : { confirmScripts: scripts }),
            },
          },
        };
        expect(decide(p, 'page.evaluate', 'https://shop.example/x', at())).toStrictEqual({
          allow: true,
          confirm: asks,
        });
        // The ordinary write follows confirmWrites alone, whatever the script switch says.
        expect(decide(p, 'page.click', 'https://shop.example/x', at())).toStrictEqual({
          allow: true,
          confirm: writes !== false,
        });
      }
    });
    await it('still refuses a script below write, quiet switch or not', async () => {
      const quiet: Policy = {
        origins: { 'https://bank.example': { level: 'read', confirmScripts: false } },
      };
      expect(decide(quiet, 'page.evaluate', 'https://bank.example/inbox', at())).toStrictEqual({
        allow: false,
        origin: 'https://bank.example',
        have: 'read',
        need: 'write',
        askable: true,
      });
    });
    await it('still refuses a script on a blocked site, quiet switch or not', async () => {
      const blocked: Policy = {
        origins: { 'https://blocked.example': { level: 'none', confirmScripts: false } },
      };
      const d = decide(blocked, 'page.evaluate', 'https://blocked.example/', at());
      expect(d.allow).toBe(false);
      expect(d.allow === false && d.askable).toBe(false);
    });
    await it('the wildcard grant is the "all sites" half of the same switch', async () => {
      const quiet = withGrants([{ scope: '*', level: 'write', confirmScripts: false }]);
      expect(decide(quiet, 'page.evaluate', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
      // Writes are untouched by the script switch, both directions.
      expect(decide(quiet, 'page.click', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
      const writesQuiet = withGrants([{ scope: '*', level: 'write', confirmWrites: false }]);
      expect(decide(writesQuiet, 'page.evaluate', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('ends with the grant it belongs to', async () => {
      const hour = withGrants([{ scope: '*', level: 'write', until: NOW + HOUR, confirmScripts: false }]);
      expect(decide(hour, 'page.evaluate', 'https://elsewhere.example/', at(NOW + HOUR - 1))).toStrictEqual({
        allow: true,
        confirm: false,
      });
      expect(decide(hour, 'page.evaluate', 'https://elsewhere.example/', at(NOW + HOUR)).allow).toBe(false);
    });
    await it('is read per session, so another session quiet grant silences nobody', async () => {
      const theirs = withGrants([{ scope: '*', level: 'write', sessionId: 'conn-b', confirmScripts: false }]);
      expect(decide(theirs, 'page.evaluate', 'https://elsewhere.example/', at(NOW, 'conn-b'))).toStrictEqual({
        allow: true,
        confirm: false,
      });
      // conn-a has no grant of its own here, so it has no access at all, quiet or not.
      expect(decide(theirs, 'page.evaluate', 'https://elsewhere.example/', at(NOW, 'conn-a')).allow).toBe(
        false,
      );
      // And without a session there is no grant either.
      expect(decide(theirs, 'page.evaluate', 'https://elsewhere.example/', at()).allow).toBe(false);
    });
    await it('is honoured for the wildcard alone, never for a grant of one origin', async () => {
      // "For this session" on one site answers a prompt, and a prompt is never a licence to run
      // code there silently — even if the field somehow arrives on such a grant.
      const answered = withGrants([
        { scope: 'https://elsewhere.example', level: 'write', confirmScripts: false },
      ]);
      expect(decide(answered, 'page.evaluate', 'https://elsewhere.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
    });
    await it('an explicit site rule beats the wildcard, quiet in either direction', async () => {
      const both = withGrants([{ scope: '*', level: 'write', confirmScripts: false }]);
      // A site with its own rule that asks wins over a quiet wildcard.
      expect(decide(both, 'page.evaluate', 'https://tracker.example/', at())).toStrictEqual({
        allow: true,
        confirm: true,
      });
      // …and a site whose own rule says quiet is quiet even where the wildcard asks.
      const askAll = withGrants([{ scope: '*', level: 'write' }]);
      const quietSite: Policy = {
        origins: { 'https://tracker.example': { level: 'write', confirmScripts: false } },
        grants: askAll.grants,
      };
      expect(decide(quietSite, 'page.evaluate', 'https://tracker.example/', at())).toStrictEqual({
        allow: true,
        confirm: false,
      });
    });
    await it('asks when the stored value is not a plain false', async () => {
      for (const stored of [0, 1, 'false', null, [], true, {}]) {
        const rule = parsePolicy({
          origins: { 'https://shop.example': { level: 'write', confirmScripts: stored } },
        });
        expect(rule.origins['https://shop.example']?.confirmScripts).toBeUndefined();
        expect(decide(rule, 'page.evaluate', 'https://shop.example/x', at())).toStrictEqual({
          allow: true,
          confirm: true,
        });
        const grants = parseGrants([{ scope: '*', level: 'write', confirmScripts: stored }], NOW);
        expect(grants[0]?.confirmScripts).toBeUndefined();
        expect(decide(withGrants(grants), 'page.evaluate', 'https://elsewhere.example/', at())).toStrictEqual(
          {
            allow: true,
            confirm: true,
          },
        );
      }
      const kept = parseGrants([{ scope: '*', level: 'write', confirmScripts: false }], NOW);
      expect(kept[0]?.confirmScripts).toBe(false);
      const keptRule = parsePolicy({
        origins: { 'https://shop.example': { level: 'write', confirmScripts: false } },
      });
      expect(keptRule.origins['https://shop.example']?.confirmScripts).toBe(false);
    });
    await it('a site grant answering a prompt never carries the switch into a rule', async () => {
      // Same shape as the popup writing a rule: the field arrives only from the person's own row.
      const next = withRuleQuiet({ level: 'write' }, 'confirmScripts', false);
      expect(next).toStrictEqual({ level: 'write', confirmScripts: false });
      // And a stored rule that carries both survives a write of one of them.
      expect(withRuleQuiet(next, 'confirmWrites', true)).toStrictEqual({
        level: 'write',
        confirmScripts: false,
      });
    });
  });

  await describe('grants: per session and per origin', async () => {
    const mine = withGrants([{ scope: '*', level: 'read', sessionId: 'conn-a' }]);
    await it('a session-bound grant applies to that session only', async () => {
      expect(decide(mine, 'page.read', 'https://elsewhere.example/', at(NOW, 'conn-a')).allow).toBe(true);
      expect(decide(mine, 'page.read', 'https://elsewhere.example/', at(NOW, 'conn-b')).allow).toBe(false);
      expect(decide(mine, 'page.read', 'https://elsewhere.example/', at(NOW)).allow).toBe(false);
    });
    await it('an origin grant raises that origin only, and its writes ask', async () => {
      const raised = withGrants([{ scope: 'https://bank.example', level: 'write', sessionId: 'conn-a' }]);
      expect(decide(raised, 'page.fill', 'https://bank.example/', at(NOW, 'conn-a'))).toStrictEqual({
        allow: true,
        confirm: true,
      });
      expect(decide(raised, 'page.fill', 'https://bank.example/', at(NOW, 'conn-b')).allow).toBe(false);
      expect(decide(raised, 'page.read', 'https://other.example/', at(NOW, 'conn-a')).allow).toBe(false);
    });
    await it('an origin grant cannot lift an explicit none', async () => {
      const raised = withGrants([{ scope: 'https://blocked.example', level: 'read' }]);
      expect(decide(raised, 'page.read', 'https://blocked.example/', at()).allow).toBe(false);
    });
    await it('an origin grant never lowers a rule', async () => {
      const low = withGrants([{ scope: 'https://tracker.example', level: 'read' }]);
      expect(levelFor(low, 'https://tracker.example/', at())).toBe('write');
    });
    await it('an origin grant matches the exact origin only', async () => {
      const raised = withGrants([{ scope: 'https://other.example', level: 'read' }]);
      expect(levelFor(raised, 'https://sub.other.example/', at())).toBe('none');
      expect(levelFor(raised, 'https://other.example:8443/', at())).toBe('none');
    });
  });

  await describe('grants: bookkeeping', async () => {
    const grants: Grant[] = [
      { scope: '*', level: 'read', until: NOW + HOUR },
      { scope: '*', level: 'write', sessionId: 'conn-a' },
      { scope: 'https://x.example', level: 'read', until: NOW + 60_000 },
    ];
    await it('wildcardGrant picks the longest-running live one', async () => {
      expect(wildcardGrant(grants, NOW)?.level).toBe('write');
      expect(wildcardGrant([grants[0]!], NOW + HOUR)).toBeNull();
    });
    await it('pruneGrants drops run-out grants and ended sessions', async () => {
      expect(pruneGrants(grants, NOW + 2 * HOUR, new Set(['conn-a'])).length).toBe(1);
      expect(pruneGrants(grants, NOW, new Set()).length).toBe(2);
    });
    await it('nextExpiry is the earliest end', async () => {
      expect(nextExpiry(grants)).toBe(NOW + 60_000);
      expect(nextExpiry([{ scope: '*', level: 'read' }])).toBeNull();
    });
  });

  await describe('parseGrants', async () => {
    await it('keeps well-formed grants', async () => {
      const parsed = parseGrants(
        [
          { scope: '*', level: 'read', until: NOW + HOUR },
          { scope: 'https://x.example', level: 'write', sessionId: 'c1' },
        ],
        NOW,
      );
      expect(parsed.length).toBe(2);
      expect(parsed[1]?.sessionId).toBe('c1');
    });
    await it('drops each malformed grant on its own', async () => {
      const parsed = parseGrants(
        [
          { scope: '*', level: 'admin' },
          { scope: 'https://x.example/path', level: 'read' },
          { scope: 'file:///', level: 'read' },
          { scope: '*', level: 'read', until: 'later' },
          { scope: '*', level: 'read', until: Number.POSITIVE_INFINITY },
          { scope: '*', level: 'read', until: NOW + MAX_GRANT_MS + 1 },
          { scope: '*', level: 'read', until: NOW - 1 },
          { scope: '*', level: 'read', sessionId: '' },
          { scope: '*', level: 'read', sessionId: 7 },
          null,
          'x',
          [],
          { scope: 'https://ok.example', level: 'read' },
        ],
        NOW,
      );
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.scope).toBe('https://ok.example');
    });
    await it('yields nothing for garbage', async () => {
      for (const raw of [null, undefined, 42, 'x', {}, { 0: { scope: '*', level: 'read' } }])
        expect(parseGrants(raw, NOW).length).toBe(0);
    });
  });

  await describe('hostsToRelease', async () => {
    const pattern = (o: string) => `${new URL(o).protocol}//${new URL(o).hostname}/*`;
    await it('gives the wildcard back once no live wildcard grant is left and no site needs it', async () => {
      const held = { wildcard: true, origins: [] };
      const live: Grant[] = [{ scope: '*', level: 'read', until: NOW + HOUR }];
      expect(hostsToRelease(held, EMPTY_POLICY, live, NOW, pattern).wildcard).toBe(false);
      expect(hostsToRelease(held, EMPTY_POLICY, live, NOW + HOUR, pattern).wildcard).toBe(true);
      expect(hostsToRelease({ wildcard: false, origins: [] }, EMPTY_POLICY, [], NOW, pattern).wildcard).toBe(
        false,
      );
    });
    // Measured in Chromium (see policy.ts): permissions.remove(['http://*/*', 'https://*/*'])
    // strips every host permission those patterns cover, not only ones requested with them — so a
    // site's OWN, separately-granted permission would go with it. Holding the wildcard back while
    // the policy still needs a site is what keeps that from happening.
    await it('does not release the wildcard while the policy still needs a site', async () => {
      const held = { wildcard: true, origins: [] };
      expect(hostsToRelease(held, policy, [], NOW, pattern).wildcard).toBe(false);
      // Once nothing needs it any more (the person's last allowed site set to None or removed),
      // the same held wildcard is released: `storage.onChanged` on the policy re-checks this.
      expect(hostsToRelease(held, EMPTY_POLICY, [], NOW, pattern).wildcard).toBe(true);
    });
    await it('keeps a site the policy allows and one a live grant needs', async () => {
      const held = {
        wildcard: false,
        origins: ['https://bank.example', 'https://once.example', 'https://held.example'],
      };
      const live: Grant[] = [{ scope: 'https://held.example', level: 'read', sessionId: 'c1' }];
      expect(hostsToRelease(held, policy, live, NOW, pattern).origins).toEqualArray(['https://once.example']);
    });
    await it('keeps a pattern another allowed origin on the same host needs', async () => {
      const held = { wildcard: false, origins: ['https://bank.example:8443'] };
      expect(hostsToRelease(held, policy, [], NOW, pattern).origins.length).toBe(0);
    });
    await it('releases a blocked site', async () => {
      const blocked: Policy = { origins: { 'https://b.example': { level: 'none' } } };
      const held = { wildcard: false, origins: ['https://b.example'] };
      expect(hostsToRelease(held, blocked, [], NOW, pattern).origins).toEqualArray(['https://b.example']);
    });
  });

  await describe('parsePolicy', async () => {
    await it('drops malformed entries one by one instead of widening or wiping', async () => {
      const parsed = parsePolicy({
        origins: {
          'https://ok.example': { level: 'read' },
          'https://ok.example/path': { level: 'write' },
          'https://typo.example': { level: 'admin' },
          'file:///': { level: 'read' },
          'https://quiet.example': { level: 'write', confirmWrites: false },
          'https://truthy.example': { level: 'write', confirmWrites: 0 },
          'https://blocked.example': { level: 'none', confirmWrites: false },
          'https://scripts.example': { level: 'write', confirmScripts: false },
          'https://bothtrue.example': { level: 'write', confirmWrites: false, confirmScripts: false },
          'https://scriptsy.example': { level: 'write', confirmScripts: 'no' },
        },
      });
      expect(Object.keys(parsed.origins).sort()).toEqualArray([
        'https://blocked.example',
        'https://bothtrue.example',
        'https://ok.example',
        'https://quiet.example',
        'https://scripts.example',
        'https://scriptsy.example',
        'https://truthy.example',
      ]);
      expect(parsed.origins['https://quiet.example']?.confirmWrites).toBe(false);
      // Only a literal false switches asking off — anything else keeps it on.
      expect(parsed.origins['https://truthy.example']?.confirmWrites).toBeUndefined();
      expect(parsed.origins['https://blocked.example']).toStrictEqual({ level: 'none' });
      // The same for the script switch, and the two fields survive a parse independently.
      expect(parsed.origins['https://scripts.example']?.confirmScripts).toBe(false);
      expect(parsed.origins['https://scripts.example']?.confirmWrites).toBeUndefined();
      expect(parsed.origins['https://bothtrue.example']).toStrictEqual({
        level: 'write',
        confirmWrites: false,
        confirmScripts: false,
      });
      expect(parsed.origins['https://scriptsy.example']?.confirmScripts).toBeUndefined();
      // A `none` rule keeps neither: it is a block, and nothing runs there to ask about.
      expect(parsed.origins['https://blocked.example']?.confirmWrites).toBeUndefined();
    });
    await it('yields an empty policy for garbage', async () => {
      for (const raw of [null, 42, 'x', { origins: 'x' }, {}])
        expect(Object.keys(parsePolicy(raw).origins).length).toBe(0);
    });
  });
};
