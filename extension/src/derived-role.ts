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
