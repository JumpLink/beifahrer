import { describe, expect, it } from '@gjsify/unit';
import { parseRecipe, type Recipe } from '@beifahrer/core';

import { BridgeError } from '../../../src/bridge/bridge.ts';
import { runRecipe, type Call } from '../../../src/recipes/runner.ts';

const LINK = 'https://login.example/qr?challenge=zz81';

function recipe(qr: unknown): Recipe {
  const r = parseRecipe({
    id: 'example/login',
    title: 'Log in',
    description: 'A login that asks the person to scan a code.',
    version: '1.0.0',
    match: { urls: ['https://login.example/*'] },
    params: [{ name: 'code', type: 'string', description: 'The code.', required: false }],
    steps: [
      {
        id: 'scan',
        action: 'person',
        kind: 'code',
        when: { role: 'button', name: ['Next'] },
        prompt: 'Scan the code and tell me the TAN.',
        codeParam: 'code',
        ...(qr === undefined ? {} : { qr }),
      },
    ],
  });
  if (typeof r === 'string') throw new Error(r);
  return r;
}

function fake(readQr: () => { text: string }) {
  const calls: string[] = [];
  const call = (async (method: string) => {
    calls.push(method);
    switch (method) {
      case 'tabs.list':
        return {
          tabs: [
            {
              tabId: 7,
              windowId: 1,
              active: true,
              focusedWindow: true,
              host: 'login.example',
              level: 'write',
              url: 'https://login.example/web/tan',
            },
          ],
        };
      case 'page.find':
        return {
          url: 'https://login.example/web/tan',
          matches: [{ ref: 'e1', description: 'button' }],
          count: 1,
          truncated: false,
        };
      case 'page.readQr':
        return readQr();
    }
    throw new Error(`unexpected ${method}`);
  }) as unknown as Call;
  return { call, calls };
}

export default async () => {
  await describe('person step with a qr option', async () => {
    await it('parses, with and without a name filter', async () => {
      const qrOf = (qr: unknown) => (recipe(qr).steps[0] as { qr?: unknown }).qr;
      expect(qrOf({})).toStrictEqual({});
      expect(qrOf({ name: ['qr'] })).toStrictEqual({ name: ['qr'] });
      expect(qrOf(undefined)).toBe(undefined);
    });

    await it('rejects an unknown key and a wrong type', async () => {
      const bad = (qr: unknown) => () => recipe(qr);
      expect(bad({ nme: ['x'] })).toThrow();
      expect(bad('yes')).toThrow();
      expect(bad({ name: [] })).toThrow();
    });

    await it('puts the decoded link into person.link and nowhere else', async () => {
      const x = fake(() => ({ text: LINK }));
      const run = await runRecipe(x.call, recipe({}), { tabId: 7 });
      expect(run.status).toBe('needs_person');
      expect(run.person?.link).toBe(LINK);
      const { person: _person, ...rest } = run;
      expect(JSON.stringify(rest).includes('challenge=zz81')).toBe(false);
    });

    await it('still ends the run, without a link, when the code cannot be read', async () => {
      const x = fake(() => {
        throw new BridgeError({
          code: 'feature_disabled',
          message: 'The "Read a login QR code" switch is off',
        });
      });
      const run = await runRecipe(x.call, recipe({}), { tabId: 7 });
      expect(run.status).toBe('needs_person');
      expect(run.person?.link).toBe(undefined);
    });

    await it('does not read a QR code unless the step asks', async () => {
      const x = fake(() => ({ text: LINK }));
      const run = await runRecipe(x.call, recipe(undefined), { tabId: 7 });
      expect(run.status).toBe('needs_person');
      expect(x.calls.includes('page.readQr')).toBe(false);
    });
  });
};
