import { describe, expect, it } from '@gjsify/unit';

import { TEXT_SKIPPED_TAGS, TextBuilder, controlText, separatorOf, type ControlFacts } from '@beifahrer/core';

const facts = (over: Partial<ControlFacts>): ControlFacts => ({
  tag: 'INPUT',
  type: 'text',
  value: '',
  checked: false,
  selected: '',
  placeholder: '',
  ariaLabel: '',
  ...over,
});

// page.read returns what a person sees. The two ways to get that wrong are code text in the answer
// and a password value in it; the second is a hard rule, so it is tested against every shape.
export default async () => {
  await describe('TextBuilder', async () => {
    await it('collapses whitespace and separates blocks by one newline', async () => {
      const b = new TextBuilder(1000);
      b.block();
      b.text('  Produktdetails \n\n ');
      b.block();
      b.text('Kategorie');
      b.block();
      expect(b.toString()).toBe('Produktdetails\nKategorie');
    });

    await it('keeps inline neighbours together unless a space is asked for', async () => {
      const b = new TextBuilder(1000);
      b.text('Chrome');
      b.text('Web');
      b.boundary('space');
      b.text('Store');
      expect(b.toString()).toBe('ChromeWeb Store');
    });

    await it('lets a line break swallow a pending space', async () => {
      const b = new TextBuilder(1000);
      b.text('a');
      b.space();
      b.block();
      b.text('b');
      expect(b.toString()).toBe('a\nb');
    });

    await it('reports full once past the limit', async () => {
      const b = new TextBuilder(5);
      b.text('abc');
      expect(b.full).toBe(false);
      b.block();
      b.text('defgh');
      expect(b.full).toBe(true);
    });
  });

  await describe('separatorOf', async () => {
    await it('breaks lines for blocks and spaces for inline-level boxes and cells', async () => {
      expect(separatorOf('block', false)).toBe('block');
      expect(separatorOf('flex', false)).toBe('block');
      expect(separatorOf('inline-block', false)).toBe('space');
      expect(separatorOf('table-cell', false)).toBe('space');
      expect(separatorOf('inline', false, 'b')).toBe('none');
      expect(separatorOf('inline', false, 'span')).toBe('space');
    });

    await it('treats a custom element as a component boundary', async () => {
      expect(separatorOf('inline', true)).toBe('space');
      expect(separatorOf('contents', true)).toBe('space');
    });
  });

  await describe('controlText', async () => {
    await it('never shows a password value', async () => {
      expect(controlText(facts({ type: 'password', value: 'hunter2', placeholder: 'secret' }))).toBe(null);
    });

    await it('shows the value, else the placeholder', async () => {
      expect(controlText(facts({ value: 'Alice' }))).toBe('Alice');
      expect(controlText(facts({ placeholder: 'Your name' }))).toBe('Your name');
      expect(controlText(facts({}))).toBe(null);
    });

    await it('shows checked state and selected options, and nothing for hidden or file inputs', async () => {
      expect(controlText(facts({ type: 'checkbox', checked: true }))).toBe('[x]');
      expect(controlText(facts({ tag: 'SELECT', type: '', selected: 'Germany' }))).toBe('Germany');
      expect(controlText(facts({ type: 'hidden', value: 'csrf' }))).toBe(null);
      expect(controlText(facts({ type: 'file', value: 'C:\\fakepath\\x' }))).toBe(null);
    });
  });

  await describe('TEXT_SKIPPED_TAGS', async () => {
    await it('covers code and non-text containers', async () => {
      for (const tag of ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']) {
        expect(TEXT_SKIPPED_TAGS.has(tag)).toBe(true);
      }
    });
  });
};
