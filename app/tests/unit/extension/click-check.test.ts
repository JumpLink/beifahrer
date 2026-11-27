import { describe, expect, it } from '@gjsify/unit';

import { planClick, pointerClick, type ClickElement } from '../../../../extension/src/click-check.ts';
import { clickWithFallback } from '../../../../extension/src/click-flow.ts';

// A page's elements as plain objects: the checks read a handful of members, so a fake with those
// members is the whole DOM the rules need.
const VIEW = { width: 1000, height: 800 };

interface FakeOpts {
  connected?: boolean;
  disabled?: boolean;
  inert?: boolean;
  visible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  /** The rect after scrollIntoView. */
  scrolled?: { x: number; y: number; width: number; height: number };
  hit?: 'self' | 'child' | 'label' | 'none' | { tag: string; id?: string; cls?: string; text?: string };
}

function fake(o: FakeOpts = {}) {
  let rect = o.rect ?? { x: 100, y: 100, width: 80, height: 30 };
  const events: string[] = [];
  let clicks = 0;
  const child = { tagName: 'SPAN', contains: () => false };
  const label = { tagName: 'LABEL', contains: (n: unknown) => n === el };
  const el: ClickElement & {
    dispatchEvent(e: unknown): boolean;
    click(): void;
    events: string[];
    clicks: number;
  } = {
    tagName: 'V6_HE-BUTTON',
    isConnected: o.connected ?? true,
    matches: (s) => s === ':disabled' && (o.disabled ?? false),
    closest: (s) => (s === '[inert]' && o.inert ? {} : null),
    checkVisibility: o.visible === undefined ? undefined : () => o.visible!,
    getBoundingClientRect: () => rect,
    scrollIntoView: () => void (rect = o.scrolled ?? rect),
    contains: (n) => n === el || n === child,
    getRootNode: () => ({
      elementFromPoint: () => {
        const h = o.hit ?? 'self';
        if (h === 'self') return el;
        if (h === 'child') return child;
        if (h === 'label') return label;
        if (h === 'none') return null;
        return {
          tagName: h.tag,
          ...(h.id ? { id: h.id } : {}),
          ...(h.cls ? { className: h.cls } : {}),
          textContent: h.text ?? '',
          contains: () => false,
        };
      },
    }),
    dispatchEvent: (e) => (events.push(String(e)), true),
    click: () => void clicks++,
    events,
    get clicks() {
      return clicks;
    },
  };
  return el;
}

export default async () => {
  await describe('planClick', async () => {
    await it('plans a click at the centre of a visible, uncovered element', async () => {
      const plan = planClick(fake(), VIEW);
      expect(plan.ok).toBe(true);
      if (plan.ok) expect([plan.x, plan.y]).toStrictEqual([140, 115]);
    });

    await it('refuses a detached, disabled, inert or invisible element, each with its own reason', async () => {
      const reasons = [
        [{ connected: false }, 'no longer in the page'],
        [{ disabled: true }, 'disabled'],
        [{ inert: true }, 'inert'],
        [{ visible: false }, 'not visible'],
      ] as const;
      for (const [opts, word] of reasons) {
        const plan = planClick(fake(opts), VIEW);
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.message.includes(word)).toBe(true);
      }
    });

    await it('scrolls an element that is below the fold into view and clicks it there', async () => {
      const plan = planClick(
        fake({
          rect: { x: 100, y: 2000, width: 80, height: 30 },
          scrolled: { x: 100, y: 300, width: 80, height: 30 },
        }),
        VIEW,
      );
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.y).toBe(315);
    });

    await it('refuses an element that stays outside the viewport after the scroll', async () => {
      const plan = planClick(fake({ rect: { x: 5000, y: 100, width: 80, height: 30 } }), VIEW);
      expect(plan.ok).toBe(false);
    });

    await it('names the element that covers the target: tag, id, class and a bit of its text', async () => {
      const plan = planClick(
        fake({ hit: { tag: 'DIV', id: 'consent', cls: 'banner wide extra', text: 'We use cookies' } }),
        VIEW,
      );
      expect(plan.ok).toBe(false);
      if (!plan.ok) {
        expect(plan.message.includes('<div#consent.banner.wide> "We use cookies"')).toBe(true);
      }
    });

    await it('is not covered by its own child or by the label that owns it', async () => {
      expect(planClick(fake({ hit: 'child' }), VIEW).ok).toBe(true);
      expect(planClick(fake({ hit: 'label' }), VIEW).ok).toBe(true);
    });

    await it('goes ahead when the hit test answers nothing', async () => {
      expect(planClick(fake({ hit: 'none' }), VIEW).ok).toBe(true);
    });
  });

  await describe('pointerClick', async () => {
    await it('sends the pointer sequence at the centre, in the order a pointer does', async () => {
      const el = fake();
      const plan = planClick(el, VIEW);
      if (!plan.ok) throw new Error('plan');
      pointerClick(el, plan, (type, at) => `${type}@${at.clientX},${at.clientY}`);
      expect(el.events).toStrictEqual([
        'pointerdown@140,115',
        'mousedown@140,115',
        'pointerup@140,115',
        'mouseup@140,115',
        'click@140,115',
      ]);
    });
  });

  await describe('clickWithFallback', async () => {
    // A custom element that ignores pointer events and reacts only to .click().
    const custom = () => {
      let pressed = false;
      return {
        attempt: async (fallback: boolean) => {
          if (fallback) pressed = true;
          return { change: pressed ? 'changed' : 'none', fallbackOk: true };
        },
        pressed: () => pressed,
      };
    };

    await it('retries once with element.click() when the first attempt changed nothing, and says so', async () => {
      const c = custom();
      const out = await clickWithFallback(c.attempt);
      expect(out.change).toBe('changed');
      expect(out.fallback).toBe('element.click');
      expect(c.pressed()).toBe(true);
    });

    await it('does not retry a click that worked', async () => {
      let calls = 0;
      const out = await clickWithFallback(async () => (calls++, { change: 'navigated' }));
      expect(calls).toBe(1);
      expect(out.fallback).toBe(undefined);
    });

    await it('retries only once, and reports a fallback that did nothing as none', async () => {
      let calls = 0;
      const out = await clickWithFallback(async () => (calls++, { change: 'none', fallbackOk: true }));
      expect(calls).toBe(2);
      expect(out.change).toBe('none');
      expect(out.fallback).toBe('element.click');
    });

    await it('keeps the first answer when the retry itself fails', async () => {
      let calls = 0;
      const out = await clickWithFallback(async (fallback) => {
        calls++;
        if (fallback) throw new Error('gone');
        return { change: 'none', fallbackOk: true };
      });
      expect(calls).toBe(2);
      expect(out.change).toBe('none');
      expect(out.fallback).toBe(undefined);
    });
  });
};
