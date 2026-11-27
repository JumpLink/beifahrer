/**
 * Before a click: is the element really there to be clicked, and is something else on top of it?
 *
 * A click that "succeeds" on an element that is detached, disabled, hidden, off-screen or covered by a
 * cookie banner is the worst answer an agent can get: ok, and nothing happened. So the page agent
 * checks first and says why not — naming the element on top, so the agent can close it — and only
 * then sends the events a pointer would.
 *
 * Idea from browser-use (`browser_use/ax.py`, MIT): check, scroll once and check again, hit-test the
 * centre. Typed by the few members it reads, so the unit tests give it plain objects.
 */

export interface Hit {
  tagName: string;
  id?: string;
  className?: unknown;
  textContent?: string | null;
  contains(other: unknown): boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClickElement extends Hit {
  isConnected: boolean;
  matches(selector: string): boolean;
  closest(selector: string): unknown;
  checkVisibility?(options: { checkOpacity: boolean; checkVisibilityCSS: boolean }): boolean;
  getBoundingClientRect(): Rect;
  scrollIntoView(options: { block: 'center'; inline: 'center'; behavior: 'instant' }): void;
  getRootNode(): unknown;
}

export type ClickPlan = { ok: true; x: number; y: number; hit: Hit | null } | { ok: false; message: string };

/** `<div id="cookie" class="banner big">Accept all…</div>` as a sentence fragment, bounded. */
export function nameOf(el: Hit): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
  const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const short = words.length > 40 ? `${words.slice(0, 40)}…` : words;
  return `<${tag}${id}${cls}>${short ? ` "${short}"` : ''}`;
}

const inside = (view: { width: number; height: number }, r: Rect): boolean => {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return cx >= 0 && cy >= 0 && cx <= view.width && cy <= view.height;
};

export function planClick(el: ClickElement, view: { width: number; height: number }): ClickPlan {
  if (!el.isConnected)
    return { ok: false, message: 'the element is no longer in the page — outline the page again' };
  if (el.matches(':disabled')) return { ok: false, message: 'the element is disabled' };
  if (el.closest('[inert]'))
    return { ok: false, message: 'the element is inside an inert region and cannot be clicked' };
  if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    return { ok: false, message: 'the element is not visible (hidden, transparent or not rendered)' };
  let rect = el.getBoundingClientRect();
  if (!inside(view, rect)) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    rect = el.getBoundingClientRect();
  }
  if (rect.width <= 0 || rect.height <= 0)
    return { ok: false, message: 'the element has no size on the page' };
  if (!inside(view, rect))
    return { ok: false, message: 'the element is outside the visible area even after scrolling to it' };
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const root = el.getRootNode() as { elementFromPoint?(x: number, y: number): Hit | null };
  const hit = root.elementFromPoint?.(x, y) ?? null;
  // The target itself, something inside it, or the label that owns it is what a person would hit.
  const covered = hit !== null && !el.contains(hit) && !(hit.tagName === 'LABEL' && hit.contains(el));
  if (covered)
    return { ok: false, message: `the element is covered by ${nameOf(hit)} — close or dismiss that first` };
  return { ok: true, x, y, hit };
}

/** The events a pointer sends before and for a click, as plain descriptions the caller turns into events. */
export const POINTER_SEQUENCE = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;

export interface Dispatcher {
  dispatchEvent(event: unknown): boolean;
}

/** Send the pointer sequence at the centre. The target is what a real pointer would hit. */
export function pointerClick(
  el: ClickElement & Dispatcher,
  plan: { x: number; y: number; hit: Hit | null },
  make: (type: (typeof POINTER_SEQUENCE)[number], at: { clientX: number; clientY: number }) => unknown,
): void {
  const target = plan.hit && el.contains(plan.hit) ? (plan.hit as unknown as Dispatcher) : el;
  for (const type of POINTER_SEQUENCE) target.dispatchEvent(make(type, { clientX: plan.x, clientY: plan.y }));
}

export interface KindElement {
  tagName: string;
  shadowRoot?: unknown;
  control?: unknown;
  closest(selector: string): unknown;
}

/** Elements the browser itself activates: a second `click()` on them repeats what the first did. */
export const NATIVE_ACTIVATABLE = 'a,area,button,input,select,textarea,summary,option,label';

/**
 * May `element.click()` be tried after a click that changed nothing visible?
 *
 * Only for CUSTOM elements (a hyphenated tag or an open shadow host): the `<v6_he-button>` of Partner
 * Center ignores dispatched pointer events and answers to `click()` alone. `change: none` only means
 * "no mutation seen", so on anything native a retry can double a click that worked: a checkbox
 * toggles back, a submit button posts twice. The target, the control of a label, and the element the
 * hit test reached are all looked at, since the real click lands on the latter.
 */
export function fallbackEligible(target: KindElement, hit: unknown): boolean {
  if (target.control) return false;
  const reached = [target, hit as Partial<KindElement> | null];
  for (const node of reached) if (node?.closest?.(NATIVE_ACTIVATABLE)) return false;
  return target.tagName.includes('-') || Boolean(target.shadowRoot);
}

interface Stateful {
  checked?: boolean;
  value?: unknown;
  selectedIndex?: number;
  control?: Stateful | null;
  closest?(selector: string): unknown;
}

/**
 * A hash of the form state of an element and of the control it stands for (its label's, or its own
 * label's). A checkbox toggle changes `checked`, a property no MutationObserver sees; without this
 * the click would read as "nothing happened". A hash, so no field value is held or passed around.
 */
export function formState(el: Stateful | null): string {
  if (!el) return '';
  const label = el.closest?.('label') as Stateful | null | undefined;
  let h = 5381;
  const seen = new Set<Stateful>();
  for (const c of [el, el.control, label?.control]) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const text = `${c.checked ?? ''}|${String(c.value ?? '')}|${c.selectedIndex ?? ''};`;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
