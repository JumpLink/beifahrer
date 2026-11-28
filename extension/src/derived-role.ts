/**
 * A role for an element that has no ARIA, decided from facts the page agent reads.
 *
 * Design systems ship their controls as custom elements (`<fluent-button>`, `<my-save>`) with no
 * `role`, and the real `<button>` sits in a shadow root or not at all. Left alone, `page_find` sees
 * nothing to click. Native semantics always win: this only runs for a custom element (a hyphen in
 * the tag) without a `role` of its own, and its answer is marked `derived` so the agent knows it
 * is a guess from behaviour, not what the page declared.
 */

export interface RoleFacts {
  tag: string;
  /** The `role` attribute, or null. */
  role: string | null;
  /** The `tabindex` attribute as a number, or null. */
  tabindex: number | null;
  /** The open shadow root is one button and nothing else interactive (the host is that button). */
  shadowButton: boolean;
  /** Computed `cursor` is `pointer`. */
  pointer: boolean;
  /** The accessible name, shadow text included. */
  name: string;
}

/** Words that make a name a command. Both UI languages beifahrer's own surface speaks. */
const CLICKISH = new Set([
  'ok',
  'click',
  'submit',
  'save',
  'send',
  'add',
  'open',
  'close',
  'cancel',
  'delete',
  'remove',
  'next',
  'back',
  'continue',
  'confirm',
  'apply',
  'search',
  'login',
  'upload',
  'download',
  'create',
  'edit',
  'speichern',
  'senden',
  'hinzufügen',
  'öffnen',
  'schließen',
  'abbrechen',
  'löschen',
  'entfernen',
  'weiter',
  'zurück',
  'bestätigen',
  'anwenden',
  'suchen',
  'anmelden',
  'hochladen',
  'erstellen',
  'bearbeiten',
]);

export function clickishName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => CLICKISH.has(word));
}

/** `button` when the facts say a custom element acts like one, else null. */
export function derivedRole(f: RoleFacts): 'button' | null {
  if (!f.tag.includes('-') || f.role) return null;
  if (f.tabindex !== null && f.tabindex >= 0) return 'button';
  if (f.shadowButton) return 'button';
  if (f.pointer && clickishName(f.name)) return 'button';
  return null;
}

export interface ButtonLike {
  contains(other: unknown): boolean;
}

export interface ShadowLike {
  querySelectorAll(selector: string): ArrayLike<ButtonLike>;
  querySelector(selector: string): unknown;
}

/**
 * The one button a shadow root is made of, or null: the host IS that button. A card with a form and
 * a button in it is a container, and calling it a button would list it next to the real one.
 * The button's own `tabindex` (a design system's focus target) is not "something else interactive";
 * a second focusable element beside it, or any field or link, is.
 */
export function wrappedButton(root: ShadowLike | null): ButtonLike | null {
  if (!root) return null;
  const buttons = root.querySelectorAll('button, [role="button"]');
  if (buttons.length !== 1) return null;
  const button = buttons[0];
  if (root.querySelector('input, select, textarea, a[href], [contenteditable]')) return null;
  const focusable = root.querySelectorAll('[tabindex]');
  for (let i = 0; i < focusable.length; i++)
    if (focusable[i] !== button && !button.contains(focusable[i])) return null;
  return button;
}

export const wrapsOneButton = (root: ShadowLike | null): boolean => wrappedButton(root) !== null;
