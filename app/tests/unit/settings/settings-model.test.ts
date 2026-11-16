import { describe, expect, it } from '@gjsify/unit';

import {
  DEFAULT_SETTINGS,
  effectiveRange,
  localeCandidates,
  overriddenByEnvironment,
  parseSettings,
  rawRange,
  serializeSettings,
  withPort,
  withPortCount,
} from '../../../src/settings/settings-model.ts';

// @gjsify/unit compares objects by reference, so structures are compared by their JSON.
const same = (actual: unknown, expected: unknown) =>
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));

export default async () => {
  await describe('settings model', async () => {
    await it('has the defaults for no file and for damage', async () => {
      for (const text of [null, '', '{', 'null', '[]', '7', '"x"'])
        same(parseSettings(text), DEFAULT_SETTINGS);
      same(effectiveRange(DEFAULT_SETTINGS), { base: 47813, count: 10 });
    });

    await it('round-trips and keeps the file minimal', async () => {
      expect(serializeSettings(DEFAULT_SETTINGS)).toBe('{}\n');
      const s = { port: 50000, portCount: 20, allowWrite: true, language: 'de' as const };
      same(parseSettings(serializeSettings(s)), s);
    });

    await it('drops a bad field and keeps the good ones', async () => {
      const s = parseSettings(
        JSON.stringify({ ports: { base: 80, count: 5 }, agent: { allowWrite: 'yes' }, language: 'fr' }),
      );
      same(s, { port: null, portCount: 5, allowWrite: false, language: 'system' });
      expect(parseSettings('{"ports":{"base":"50000","count":1.5}}').port).toBe(null);
      expect(parseSettings('{"ports":{"base":50000,"count":65}}').portCount).toBe(null);
      expect(parseSettings('{"ports":{"base":65535,"count":10}}').portCount).toBe(null);
    });

    await it('never widens past the top port', async () => {
      const s = withPort(withPortCount(DEFAULT_SETTINGS, 64), 65530);
      const r = effectiveRange(s);
      expect(r.base + r.count - 1 <= 65535).toBe(true);
      expect(withPortCount(withPort(DEFAULT_SETTINGS, 65530), 64).portCount).toBe(6);
      same(effectiveRange(withPort(DEFAULT_SETTINGS, 65535)), { base: 65535, count: 1 });
    });

    await it('stores a default value as "not set" and refuses nonsense', async () => {
      expect(withPort(DEFAULT_SETTINGS, 47813).port).toBe(null);
      expect(withPortCount(DEFAULT_SETTINGS, 10).portCount).toBe(null);
      same(withPort(DEFAULT_SETTINGS, 80), DEFAULT_SETTINGS);
      same(withPortCount(DEFAULT_SETTINGS, 0), DEFAULT_SETTINGS);
      expect(withPortCount(DEFAULT_SETTINGS, 999).portCount).toBe(64);
    });

    await it('lets a flag beat the environment beat the file, empty meaning unset', async () => {
      const s = { ...DEFAULT_SETTINGS, port: 50000, portCount: 4 };
      same(rawRange({}, {}, s), { port: 50000, count: 4 });
      same(rawRange({}, { BEIFAHRER_PORT: '51000', BEIFAHRER_PORT_COUNT: '' }, s), {
        port: '51000',
        count: 4,
      });
      expect(rawRange({ port: 52000 }, { BEIFAHRER_PORT: '51000' }, s).port).toBe(52000);
      expect(overriddenByEnvironment({ BEIFAHRER_PORT: ' ' })).toBe(false);
      expect(overriddenByEnvironment({ BEIFAHRER_PORT_COUNT: '3' })).toBe(true);
    });

    await it('offers the language override alone, or the system list', async () => {
      same(localeCandidates('de', ['en_US']), ['de']);
      same(localeCandidates('system', ['en_US']), ['en_US']);
    });

    await it('has no field for a policy action: ports, a snippet default and a language', async () => {
      expect(Object.keys(DEFAULT_SETTINGS).sort().join()).toBe('allowWrite,language,port,portCount');
    });
  });
};
