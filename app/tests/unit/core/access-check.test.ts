import { describe, expect, it } from '@gjsify/unit';

import { DEFAULT_FEATURES, accessCheck, type AccessCheck, type Features, type Policy } from '@beifahrer/core';

/** Every case here is a way the answer could be wrong in the direction that loses a refusal. */
const policy: Policy = {
  origins: {
    'https://tracker.example': { level: 'write' },
    // The site the person watches the agent work on: writes need no asking there.
    'https://quiet.example': { level: 'write', confirmWrites: false },
    'https://bank.example': { level: 'read' },
    'https://blocked.example': { level: 'none' },
  },
};

/** The answer, or a failure: a refusal to the QUESTION is a string, and that must be a visible one. */
const check = (over: Parameters<typeof accessCheck>[0]): AccessCheck => {
  const answer = accessCheck(over);
  if (typeof answer === 'string') throw new Error(`refused the question: ${answer}`);
  return answer;
};

const on = (features: Partial<Features> = {}): Features => ({ ...DEFAULT_FEATURES, ...features });

export default async () => {
  await describe('accessCheck', async () => {
    await it('names the feature a method belongs to and says the switch is on', async () => {
      const read = check({ features: on(), policy, method: 'page.read', url: 'https://tracker.example/x' });
      expect(read.feature).toBe('read');
      expect(read.featureOn).toBe(true);
      expect(read.need).toBe('read');
      expect(read.have).toBe('write');
    });

    await it('reports a switched-off feature as the step that stops the call', async () => {
      const shot = check({
        features: on(), // screenshots are off by default
        policy,
        method: 'page.screenshot',
        url: 'https://tracker.example/',
        hostGranted: true,
      });
      expect(shot.allowed).toBe(false);
      expect(shot.stage).toBe('feature');
      expect(shot.feature).toBe('screenshot');
      expect(shot.featureOn).toBe(false);
      expect(shot.reason).toMatch(/Take screenshots/);
    });

    await it('reports a level below what the method needs', async () => {
      const write = check({ features: on(), policy, method: 'page.click', url: 'https://bank.example/' });
      expect(write.allowed).toBe(false);
      expect(write.stage).toBe('level');
      expect(write.have).toBe('read');
      expect(write.need).toBe('write');
      expect(write.askable).toBe(true);
      expect(write.reason).toMatch(/https:\/\/bank\.example is at level "read"/);
    });

    await it('reports a blocked site as a refusal nobody may be asked about', async () => {
      const blocked = check({
        features: on(),
        policy,
        method: 'page.read',
        url: 'https://blocked.example/x',
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.stage).toBe('level');
      expect(blocked.have).toBe('none');
      expect(blocked.askable).toBe(false);
      expect(blocked.reason).toMatch(/blocked this site/);
    });

    await it('gives a non-web page no origin and refuses it at the level step', async () => {
      const local = check({ features: on(), policy, method: 'page.read', url: 'file:///etc/passwd' });
      expect(local.allowed).toBe(false);
      expect(local.stage).toBe('level');
      expect(local.origin).toBeNull();
      expect(local.askable).toBe(false);
      expect(local.reason).toMatch(/non-web page/);
      // No URL at all is the same shape: there is no page to ask a policy about.
      expect(check({ features: on(), policy, method: 'page.read' }).origin).toBeNull();
    });

    await it('says a write would be confirmed, and a read would not', async () => {
      const write = check({
        features: on(),
        policy,
        method: 'page.click',
        url: 'https://tracker.example/',
        hostGranted: true,
      });
      expect(write.allowed).toBe(true);
      expect(write.stage).toBe('ok');
      expect(write.confirm).toBe(true);
      expect(write.reason).toMatch(/confirm it first/);
      expect(
        check({
          features: on(),
          policy,
          method: 'page.read',
          url: 'https://tracker.example/',
          hostGranted: true,
        }).confirm,
      ).toBe(false);
    });

    await it('honours a site rule that switched confirmation off for writes', async () => {
      const quiet = check({
        features: on({ script: true }),
        policy,
        method: 'page.click',
        url: 'https://quiet.example/',
        hostGranted: true,
      });
      expect(quiet.allowed).toBe(true);
      expect(quiet.confirm).toBe(false);
    });

    await it('keeps ALWAYS_CONFIRM on a script whatever the site rule says', async () => {
      const script = check({
        features: on({ script: true }),
        policy,
        method: 'page.evaluate',
        url: 'https://quiet.example/',
        hostGranted: true,
      });
      expect(script.allowed).toBe(true);
      expect(script.need).toBe('write');
      expect(script.confirm).toBe(true);
      expect(script.reason).toMatch(/confirm it first/);
    });

    await it('refuses a method name the policy table does not know', async () => {
      const answer = accessCheck({
        features: on(),
        policy,
        method: 'page.exec',
        url: 'https://bank.example/',
      });
      expect(typeof answer).toBe('string');
      expect(answer).toMatch(/is not a Beifahrer method/);
    });

    await it('reports the missing browser grant as its own step, asking nobody', async () => {
      const revoked = check({
        features: on(),
        policy,
        method: 'page.read',
        url: 'https://tracker.example/',
        hostGranted: false,
      });
      expect(revoked.allowed).toBe(false);
      expect(revoked.stage).toBe('grant');
      expect(revoked.hostGranted).toBe(false);
      // A method that touches no page consults no grant, and says so rather than claiming one.
      const list = check({ features: on(), policy, method: 'tabs.list', hostGranted: null });
      expect(list.allowed).toBe(true);
      expect(list.hostGranted).toBeNull();
      expect(list.need).toBe('none');
    });

    await it('reports what the browser cannot do as its own step', async () => {
      const mvp = check({
        features: on({ script: true }),
        policy,
        method: 'page.evaluate',
        url: 'https://tracker.example/',
        hostGranted: true,
        unsupported: 'a Manifest V3 content script cannot compile a string into code',
      });
      expect(mvp.allowed).toBe(false);
      expect(mvp.stage).toBe('unsupported');
      expect(mvp.reason).toMatch(/cannot run in this browser at all/);
    });
  });
};
