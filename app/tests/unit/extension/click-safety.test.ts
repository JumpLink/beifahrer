import { describe, expect, it } from '@gjsify/unit';
import { verdictOf } from '@beifahrer/core';

import { fallbackEligible, formState } from '../../../../extension/src/click-check.ts';
import { clickWithFallback } from '../../../../extension/src/click-flow.ts';
import { InflightTracker, watchGrant } from '../../../../extension/src/inflight-tracker.ts';

// The retry with element.click() must never repeat a click that worked. `none` only says no mutation
// was seen, and a checkbox toggles a property while a button may only start a request.
interface Fake {
  tagName: string;
  checked?: boolean;
  value?: string;
  shadowRoot?: unknown;
  control?: Fake;
  closest(selector: string): unknown;
}

const native = (tag: string, extra: Partial<Fake> = {}): Fake => {
  const self: Fake = {
    tagName: tag.toUpperCase(),
    closest: (s) => (s.split(',').includes(tag) ? self : null),
    ...extra,
  };
  return self;
};
const custom = (tag = 'v6_he-button', extra: Partial<Fake> = {}): Fake => ({
  tagName: tag.toUpperCase(),
  closest: () => null,
  ...extra,
});

export default async () => {
  await describe('fallbackEligible', async () => {
    await it('allows a hyphenated custom element and an open shadow host', async () => {
      expect(fallbackEligible(custom(), null)).toBe(true);
      expect(fallbackEligible(custom('div', { shadowRoot: {} }), null)).toBe(true);
    });

    await it('refuses a plain div and every native activatable element', async () => {
      expect(fallbackEligible(custom('div'), null)).toBe(false);
      for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'summary', 'option'])
        expect(fallbackEligible(native(tag), null)).toBe(false);
    });

    await it('refuses a label, and a custom element whose hit is a native control or inside a label', async () => {
      const box = native('input', { checked: false });
      expect(fallbackEligible(native('label', { control: box }), null)).toBe(false);
      expect(fallbackEligible(custom(), box)).toBe(false);
      expect(fallbackEligible(custom(), native('label'))).toBe(false);
    });
  });

  await describe('formState', async () => {
    await it('changes when a checkbox toggles, so the click reads as changed', async () => {
      const box = native('input', { checked: false });
      const before = { doc: 'd', url: 'u', n: 0, f: formState(box) };
      box.checked = true;
      const after = { doc: 'd', url: 'u', n: 0, f: formState(box) };
      expect(verdictOf(before, after).change).toBe('changed');
    });

    await it('follows a label to its control', async () => {
      const box = native('input', { checked: false });
      const label = native('label', { control: box });
      const before = formState(label);
      box.checked = true;
      expect(formState(label) === before).toBe(false);
    });

    await it('is the same for an untouched element and does not hold the value', async () => {
      const field = native('input', { value: 'secret-text' });
      expect(formState(field)).toBe(formState(field));
      expect(formState(field).includes('secret')).toBe(false);
    });
  });

  await describe('clickWithFallback safety', async () => {
    // A checkbox: the pointer click toggles it, and a second click would toggle it back.
    const checkbox = (via: 'checkbox' | 'label') => {
      const box = native('input', { checked: false });
      const target = via === 'label' ? native('label', { control: box }) : box;
      let clicks = 0;
      return {
        box,
        clicks: () => clicks,
        attempt: async () => {
          clicks++;
          const before = { doc: 'd', url: 'u', n: 0, f: formState(target) };
          box.checked = !box.checked;
          const after = { doc: 'd', url: 'u', n: 0, f: formState(target) };
          return { ...verdictOf(before, after), fallbackOk: fallbackEligible(target, null) };
        },
      };
    };

    for (const via of ['checkbox', 'label'] as const) {
      await it(`a click on a ${via} is changed, is not repeated and stays checked`, async () => {
        const c = checkbox(via);
        const out = await clickWithFallback(c.attempt);
        expect(out.change).toBe('changed');
        expect(out.fallback).toBe(undefined);
        expect(c.clicks()).toBe(1);
        expect(c.box.checked).toBe(true);
      });
    }

    await it('does not retry a native button that only fires a request, even when nothing changed', async () => {
      let calls = 0;
      const out = await clickWithFallback(
        async () => (calls++, { change: 'none', fallbackOk: fallbackEligible(native('button'), null) }),
      );
      expect(calls).toBe(1);
      expect(out.fallback).toBe(undefined);
    });

    await it('does not retry a custom element once a request started since the click', async () => {
      let calls = 0;
      const out = await clickWithFallback(
        async () => (calls++, { change: 'none', fallbackOk: true }),
        () => true,
      );
      expect(calls).toBe(1);
      expect(out.fallback).toBe(undefined);
    });

    await it('still retries a custom element that ignores pointer events, without webRequest', async () => {
      let pressed = false;
      const out = await clickWithFallback(async (fallback) => {
        if (fallback) pressed = true;
        return { change: pressed ? 'changed' : 'none', fallbackOk: fallbackEligible(custom(), null) };
      });
      expect(out.fallback).toBe('element.click');
      expect(out.change).toBe('changed');
      expect(pressed).toBe(true);
      expect('fallbackOk' in out).toBe(false);
    });
  });

  await describe('InflightTracker.startedSince', async () => {
    await it('sees a request that started and already ended, of this tab only', async () => {
      const t = new InflightTracker();
      t.start('a', 1, 100);
      t.end('a');
      expect(t.startedSince(1, 50)).toBe(true);
      expect(t.startedSince(1, 101)).toBe(false);
      expect(t.startedSince(2, 50)).toBe(false);
    });
  });

  await describe('watchGrant', async () => {
    await it('installs the watch when webRequest is granted later, and not for other permissions', async () => {
      let listener: ((g: { permissions?: string[] }) => void) | undefined;
      let installs = 0;
      watchGrant({ onAdded: { addListener: (fn) => void (listener = fn) } }, () => void installs++);
      listener?.({ permissions: ['downloads'] });
      expect(installs).toBe(0);
      listener?.({ permissions: ['webRequest'] });
      expect(installs).toBe(1);
    });

    await it('does nothing where the permissions API is missing', async () => {
      watchGrant(undefined, () => {});
    });
  });
};
