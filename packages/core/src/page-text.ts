/**
 * What `page.read` returns: the text a person SEES, not the text the DOM holds.
 *
 * `textContent` is the DOM's text, and on a modern app most of it is not for reading: inline
 * `<script>` and `<style>` bodies, templates, hidden subtrees. Taken from the top it also fills the
 * `maxChars` budget before the first heading, and glues neighbouring blocks together. The page agent
 * walks the rendered tree instead and feeds this builder; the decisions that need no DOM live here so
 * they are testable without one.
 */

/** Elements whose text is never page content. SVG is lower case in an HTML document, so compare upper. */
export const TEXT_SKIPPED_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'HEAD',
  'SVG',
  'IFRAME',
  'FRAME',
  'OBJECT',
  'EMBED',
  'AUDIO',
  'VIDEO',
  'CANVAS',
  'DATALIST',
]);

/** Inline tags that format a word in place (`<b>x</b>y` is one word). Any other inline box, a bare span above all, is a component of its own: Wiz and Material pages build every label from spans. */
const GLUING_TAGS = new Set([
  'a',
  'b',
  'i',
  'u',
  'em',
  'strong',
  'small',
  'sub',
  'sup',
  'mark',
  'code',
  'abbr',
  'cite',
  'q',
  's',
  'kbd',
]);

export type Separator = 'block' | 'space' | 'none';

/**
 * What a box puts between itself and its neighbours, from its computed `display`.
 *
 * Block-level boxes start a new line; inline-level boxes and table cells sit beside others and need a
 * space so two components do not run together ("Kategorie" + "Beschreibung"). A plain inline box adds
 * nothing, because `<b>x</b>y` is one word. A custom element is a component boundary even while its
 * `display` is the default `inline`.
 */
export function separatorOf(display: string, customElement: boolean, tag = ''): Separator {
  if (display === 'contents' || display === 'inline') {
    return customElement || !GLUING_TAGS.has(tag.toLowerCase()) ? 'space' : 'none';
  }
  if (display.startsWith('inline-') || display === 'table-cell' || display === 'table-column') return 'space';
  return 'block';
}

export interface ControlFacts {
  /** Upper-case tag name. */
  tag: string;
  /** `input.type`, lower case; empty for other tags. */
  type: string;
  value: string;
  checked: boolean;
  /** The visible text of the selected `<option>`s of a select. */
  selected: string;
  placeholder: string;
  /** `aria-label`, when no visible label names the control. */
  ariaLabel: string;
}

const NO_TEXT_INPUTS = new Set(['hidden', 'image', 'color', 'range', 'file']);

/**
 * The text a form control shows a person, or null when it shows none worth reading.
 *
 * A password field is null whatever it holds: a value read here would travel to the agent, and the
 * person types those (hard rule). Same for any type that is not text. A control with an empty value
 * shows its placeholder, because that is what the person sees.
 */
export function controlText(c: ControlFacts): string | null {
  if (c.tag === 'INPUT') {
    if (c.type === 'password' || NO_TEXT_INPUTS.has(c.type)) return null;
    if (c.type === 'checkbox' || c.type === 'radio') {
      return [c.checked ? '[x]' : '[ ]', c.ariaLabel].filter(Boolean).join(' ');
    }
  }
  if (c.tag === 'SELECT') return [c.selected, c.ariaLabel].filter(Boolean).join(' ') || null;
  const shown = c.value || c.placeholder;
  const labelled = c.ariaLabel && !c.value ? `${c.ariaLabel}:` : '';
  return [labelled, shown].filter(Boolean).join(' ') || null;
}

/**
 * Collects text pieces and decides the whitespace between them: runs collapse to one space, a block
 * boundary becomes one newline, nothing leads or trails. `full` turns true once more than `limit`
 * characters are in, so the walk can stop instead of reading a 5 MB page for 20 000 characters.
 */
export class TextBuilder {
  #out = '';
  #gap: '' | ' ' | '\n' = '';
  #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  get full(): boolean {
    return this.#out.length > this.#limit;
  }

  /** Text as the page wrote it: whitespace collapses, but a leading or trailing space survives as a gap. */
  text(raw: string): void {
    if (!raw) return;
    const lead = /^\s/.test(raw);
    const trail = /\s$/.test(raw);
    const words = raw.replace(/\s+/g, ' ').trim();
    if (!words) {
      this.space();
      return;
    }
    if (lead) this.space();
    this.#put(words);
    if (trail) this.space();
  }

  /** A word-sized gap, unless a line break is already pending. */
  space(): void {
    if (this.#gap === '') this.#gap = ' ';
  }

  /** A line break, which also swallows a pending space. */
  block(): void {
    this.#gap = '\n';
  }

  boundary(kind: Separator): void {
    if (kind === 'block') this.block();
    else if (kind === 'space') this.space();
  }

  toString(): string {
    return this.#out;
  }

  #put(words: string): void {
    if (this.#out) this.#out += this.#gap;
    this.#gap = '';
    this.#out += words;
  }
}
