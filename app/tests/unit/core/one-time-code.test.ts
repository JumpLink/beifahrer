import { describe, expect, it } from '@gjsify/unit';
import {
  REDACTED_CODE,
  parseOneTimeCode,
  refuseCodeField,
  scrubSecrets,
  type CodeFieldFacts,
} from '@beifahrer/core';

const field = (patch: Partial<CodeFieldFacts> = {}): CodeFieldFacts => ({
  tag: 'input',
  type: 'text',
  autocomplete: '',
  inputmode: '',
  words: 'TAN',
  ...patch,
});

// ADR 0020: every way the one-time-code guard can refuse, and the one way it lets a code through.
export default async () => {
  await describe('parseOneTimeCode', async () => {
    await it('takes 4 to 10 letters and digits', async () => {
      for (const ok of ['1234', '123456', 'AbC123xyz9', '0000000000'])
        expect(parseOneTimeCode(ok)).toStrictEqual({ code: ok });
    });
    await it('refuses everything else, without echoing the value', async () => {
      for (const bad of [
        '123',
        '12345678901',
        '12 34',
        '12-34',
        '',
        '１２３４５６',
        'ab\ncd',
        5,
        null,
        undefined,
      ]) {
        const r = parseOneTimeCode(bad);
        expect('error' in r).toBe(true);
        expect(JSON.stringify(r)).not.toMatch(/12 34|12-34/);
      }
    });
  });

  await describe('refuseCodeField', async () => {
    await it('lets a marked text field through', async () => {
      expect(refuseCodeField(field())).toBe(null);
      expect(refuseCodeField(field({ words: 'Sicherheitsfeld', autocomplete: 'one-time-code' }))).toBe(null);
      expect(refuseCodeField(field({ words: 'Feld', inputmode: 'numeric' }))).toBe(null);
      expect(refuseCodeField(field({ words: 'Einmalpasswort-Code' }))).toBe(null);
      expect(refuseCodeField(field({ words: 'Enter OTP', type: 'tel' }))).toBe(null);
    });
    await it('never fills a password field, whatever it is called', async () => {
      expect(refuseCodeField(field({ type: 'password' }))).toMatch(/password fields are never filled/);
      expect(
        refuseCodeField(field({ type: 'password', autocomplete: 'one-time-code', words: 'TAN' })),
      ).not.toBe(null);
    });
    await it('refuses a field labelled PIN or password', async () => {
      for (const words of ['PIN', 'Ihre PIN', 'Passwort', 'password', 'TAN PIN', 'Kennwort'])
        expect(refuseCodeField(field({ words }))).toMatch(/PIN or password/);
      expect(refuseCodeField(field({ words: 'TAN', autocomplete: 'current-password' }))).not.toBe(null);
      expect(refuseCodeField(field({ words: 'Code', autocomplete: 'one-time-code' }))).toBe(null);
    });
    await it('refuses other kinds of code and other kinds of element', async () => {
      expect(refuseCodeField(field({ words: 'Postcode' }))).toMatch(/another kind of code/);
      expect(refuseCodeField(field({ words: 'Gutscheincode' }))).toMatch(/another kind of code/);
      expect(refuseCodeField(field({ words: 'PLZ' }))).not.toBe(null);
      expect(refuseCodeField(field({ tag: 'textarea' }))).toMatch(/text input only/);
      expect(refuseCodeField(field({ tag: 'div' }))).not.toBe(null);
      expect(refuseCodeField(field({ type: 'hidden' }))).toMatch(/not a code field/);
      expect(refuseCodeField(field({ type: 'email' }))).toMatch(/not a code field/);
    });
    await it('refuses a field the page does not mark as a code', async () => {
      expect(refuseCodeField(field({ words: 'Name' }))).toMatch(/does not mark/);
      expect(refuseCodeField(field({ words: '' }))).toMatch(/does not mark/);
    });
  });

  await describe('scrubSecrets', async () => {
    await it('replaces a secret everywhere, deeply', async () => {
      const out = scrubSecrets({ a: 'x 123456 y', b: ['123456', { c: 'no' }], n: 5 }, ['123456']);
      expect(JSON.stringify(out)).toBe(
        JSON.stringify({ a: `x ${REDACTED_CODE} y`, b: [REDACTED_CODE, { c: 'no' }], n: 5 }),
      );
    });
    await it('leaves a value alone when there is nothing to hide', async () => {
      const v = { a: 'text' };
      expect(scrubSecrets(v, [])).toBe(v);
      expect(scrubSecrets(v, [''])).toBe(v);
    });
  });
};
