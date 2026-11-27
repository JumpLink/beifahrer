/**
 * The page agent: injected on demand into a tab the policy allows, in the extension's isolated
 * world. It sees the page's DOM but not the page's JavaScript, and the page cannot see it.
 *
 * It does exactly nine things — read, outline, find, meta, wait, describe, fill, click,
 * evaluate — and answers messages from the background. The policy was already checked there; this
 * script trusts its caller and nothing else. While it works, it shows the person a pill with a Stop
 * button (src/page-indicator.ts), and it hides that pill on request before a screenshot.
 *
 * Refs (`e1`, `e2`, …) are handed out by `outline` and stay valid for the life of the document:
 * an element keeps its ref across outlines, so an agent can outline, think, and act later.
 */

import { browser } from '@wxt-dev/browser';
import {
  clipText,
  controlText,
  downloadFilename,
  EXPECT_STATES,
  expectationOf,
  linkLine,
  metaMatches,
  normalizeText,
  parseElementQuery,
  parseOneTimeCode,
  refuseCodeField,
  parseKeySpec,
  parseMetaQuery,
  projectValue,
  queryMatches,
  resolveDownloadTarget,
  scriptError,
  separatorOf,
  TEXT_SKIPPED_TAGS,
  TextBuilder,
  type ElementQuery,
  type ExpectRequest,
  type FoundElement,
  type KeySpec,
  type MetaQuery,
  type UploadFile,
} from '@beifahrer/core';
import { FRAME_HELLO } from '@beifahrer/core';
import {
  CHOOSER_ARMED,
  CHOOSER_BOX,
  CHOOSER_MARK,
  installChooserHook,
  type HookWindow,
} from '../src/chooser-hook.ts';
import { MutationProbe, type ProbeDocument } from '../src/act-probe.ts';
import { fallbackEligible, formState, planClick, pointerClick } from '../src/click-check.ts';
import { deepActive, typeInto, type FillEnv } from '../src/field-fill.ts';
import { afterRepaint, HOST_TAG, hideNow, keepShown, show } from '../src/page-indicator.ts';
import type { PageRequest, PageResponse } from '../src/page-messages.ts';

interface AgentState {
  refs: Map<string, WeakRef<Element>>;
  ids: WeakMap<Element, string>;
  next: number;
}

declare global {
  var __beifahrer: AgentState | undefined;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'IFRAME']);
const TEXT_INPUTS = new Set([
  'text',
  'email',
  'search',
  'url',
  'tel',
  'number',
  'password',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
  '',
]);

const clip = clipText;

function rendered(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * Is this element on screen for a person? `inert` counts as hidden: an SPA that parks the previous
 * view behind `inert` (or `aria-hidden`) leaves its DOM in place, and listing it would hand the
 * agent controls nobody can use.
 *
 * A checkbox or radio is the one exception to "no box, not there": design systems (Fluent
 * ChoiceGroup, Material) hide the real `<input>` with `display: none` or a zero box and draw a
 * label in its place. The control is then as visible as its label is, and the label names it.
 */
function visible(el: Element): boolean {
  if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  if (rendered(el)) return true;
  return (
    el instanceof HTMLInputElement &&
    (el.type === 'radio' || el.type === 'checkbox') &&
    Array.from(el.labels ?? []).some(rendered)
  );
}

/**
 * The tree an element lives in: its document, or the shadow root it was written in.
 *
 * Everything that resolves a NAME has to ask here, not the top document. Ids are document-local and
 * do not cross a shadow boundary, so `document.getElementById('save')` and
 * `document.querySelector('label[for=…]')` both come back empty for a label written inside a shadow
 * root — and an element the walk can see but cannot name is an element `page_find` cannot find by
 * name, which is how it looks to an agent: a nameless button (issue #4). The same is true one
 * boundary further out, for a label written inside a same-origin frame (issue #30).
 *
 * Which is why this does NOT ask `instanceof Document`, though that reads like the obvious thing to
 * write: a same-origin frame has its own global, so its document is not an instance of THIS realm's
 * `Document` constructor, and the check quietly answers "not a document" and hands back the top one
 * — which is then asked for an id that is not in it. Duck typing on the one method every root has.
 * The wrong version fails silently: names come back empty rather than as an error, so every element
 * in a frame looks unnamed and `page_find` reports nothing.
 */
function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode() as Document | ShadowRoot | null;
  return root && typeof root.querySelectorAll === 'function' ? root : document;
}

function labelFor(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => rootOf(el).getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }
  if (el.id) {
    const label = rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent;
  }
  const wrapping = el.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent;
  const placeholder = el.getAttribute('placeholder') ?? el.getAttribute('aria-placeholder');
  if (placeholder) return placeholder;
  const text = (el as HTMLElement).innerText;
  if (text?.trim()) return text;
  const title = el.getAttribute('title');
  if (title?.trim()) return title;
  // An icon button: the words live in a visually-hidden span (`innerText` can come back empty for
  // clipped text), an <img alt>, an SVG <title> or a child's aria-label. Fluent UI toolbars are
  // built like this, and the result was `button ""`.
  const inner = el.textContent?.trim();
  if (inner) return inner;
  const hint = el.querySelector('[aria-label], img[alt], svg title, [title]');
  const hinted =
    hint?.getAttribute('aria-label') ??
    hint?.getAttribute('alt') ??
    hint?.getAttribute('title') ??
    hint?.textContent;
  if (hinted?.trim()) return hinted;
  return el.getAttribute('name') ?? el.getAttribute('alt') ?? '';
}

type Kind =
  | { role: 'heading'; level: number }
  | {
      role:
        | 'link'
        | 'button'
        | 'textbox'
        | 'richtext'
        | 'checkbox'
        | 'radio'
        | 'combobox'
        | 'file'
        | 'tab'
        | 'menuitem'
        | 'listbox'
        | 'option';
    };

function kindOf(el: Element): Kind | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { role: 'heading', level: Number(tag[1]) };
  const role = el.getAttribute('role');
  if (tag === 'A' && el.hasAttribute('href')) return { role: 'link' };
  if (tag === 'BUTTON' || role === 'button') return { role: 'button' };
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return { role: 'checkbox' };
    if (type === 'radio') return { role: 'radio' };
    if (type === 'file') return { role: 'file' };
    if (type === 'button' || type === 'submit' || type === 'reset') return { role: 'button' };
    if (TEXT_INPUTS.has(type)) return { role: 'textbox' };
    return null;
  }
  const html = el as HTMLElement;
  // The editing HOST only — every descendant of a contenteditable is editable too, and listing
  // each paragraph of a comment box as its own textbox would bury the one thing that matters.
  // Checked before role=textbox: CKEditor 5 and ProseMirror put that role on their editable,
  // and "richtext" is what tells the agent (and a recipe) that as=html will keep formatting.
  if (html.isContentEditable && !html.parentElement?.isContentEditable) return { role: 'richtext' };
  if (tag === 'TEXTAREA' || role === 'textbox') return { role: 'textbox' };
  if (tag === 'SELECT' || role === 'combobox') return { role: 'combobox' };
  if (role === 'checkbox' || role === 'switch') return { role: 'checkbox' };
  if (role === 'radio') return { role: 'radio' };
  if (role === 'tab') return { role: 'tab' };
  if (role === 'menuitem') return { role: 'menuitem' };
  if (role === 'listbox') return { role: 'listbox' };
  if (role === 'option') return { role: 'option' };
  if (role === 'link') return { role: 'link' };
  return null;
}

function state(): AgentState {
  globalThis.__beifahrer ??= { refs: new Map(), ids: new WeakMap(), next: 1 };
  return globalThis.__beifahrer;
}

// --- a script's reach, and its lifetime --------------------------------------------------------

/** Marks the script currently running, so a script that outlives its call can be told to stop. */
let scriptRun = 0;
let scriptRunning = false;

/** A token for the run that starts now; pass it to `endScript` and `scriptAlive`. */
function beginScript(): number {
  scriptRun++;
  scriptRunning = true;
  return scriptRun;
}

function endScript(token: number): void {
  // A later run already took over: its flag is the live one.
  if (token === scriptRun) scriptRunning = false;
}

/** Is the run that started with `token` still the current one, and still going? */
function scriptAlive(token: number): boolean {
  return token === scriptRun && scriptRunning;
}

/** The agent session that asked, as the pill names it (ADR 0007). Untrusted text, set as text. */
let session: string | undefined;

/**
 * Is this agent inside a frame? `window.top !== window` is the test, and it is the one the platform
 * gives: false in the top document, true in every frame, whatever the frame's origin. Used for the
 * pill's wording, because "Agent is reading" inside an embedded page would name the wrong site — what
 * is read there is the embedded page, under the embedded page's own level (issue #32).
 */
const inFrame = (() => {
  try {
    return window.top !== window;
  } catch {
    // A cross-origin parent makes `window.top` unreachable — and that IS the case, so the answer is
    // true rather than an exception: this document is not the top one.
    return true;
  }
})();

/** `beifahrer.sleep`, but it wakes on a run that is over: beifahrer paused, or the call replaced. */
function interruptibleSleep(ms: number, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (!scriptAlive(token)) {
        reject(new Error('Beifahrer was paused or the script was replaced — it stopped here'));
        return;
      }
      // The pill and its Stop button must survive a script that is running: it is the one control
      // the person has while it does. Re-asserted on every tick rather than once (page-indicator).
      keepShown('editing', session, inFrame);
      if (Date.now() - started >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(ms, 250));
    };
    tick();
  });
}

function refOf(el: Element): string {
  const s = state();
  let id = s.ids.get(el);
  if (!id) {
    id = `e${s.next++}`;
    s.ids.set(el, id);
    s.refs.set(id, new WeakRef(el));
  }
  return id;
}

function byRef(ref: string): Element | null {
  const el = state().refs.get(ref)?.deref() ?? null;
  return el && el.isConnected ? el : null;
}

function describe(el: Element, kind: Kind): string {
  const name = clip(labelFor(el), 80);
  switch (kind.role) {
    case 'heading':
      return `h${kind.level} "${name}"`;
    case 'link': {
      return linkLine(name, (el as HTMLAnchorElement).href);
    }
    case 'textbox': {
      const input = el as HTMLInputElement;
      if (input.type === 'password') return `password "${name}" (never filled)`;
      const value = input.value ?? '';
      return `textbox "${name}"${value ? ` = "${clip(value, 80)}"` : ' (empty)'}`;
    }
    case 'richtext': {
      const text = (el as HTMLElement).innerText ?? '';
      const label = el.getAttribute('aria-label') ?? el.getAttribute('aria-placeholder') ?? '';
      return `richtext "${clip(label, 60)}"${text.trim() ? ` = "${clip(text, 120)}"` : ' (empty)'}`;
    }
    case 'checkbox':
    case 'radio': {
      const checked = (el as HTMLInputElement).checked ?? el.getAttribute('aria-checked') === 'true';
      return `${kind.role} "${name}" ${checked ? '[x]' : '[ ]'}`;
    }
    case 'combobox': {
      const select = el as HTMLSelectElement;
      const selected = select.selectedOptions?.[0]?.textContent ?? '';
      // An open ARIA combobox (mat-select and friends) keeps its options in an overlay elsewhere;
      // saying so tells the agent to look for `option` lines rather than for a <select>.
      const open = el.getAttribute('aria-expanded') === 'true' ? ' [expanded: see the option lines]' : '';
      return `combobox "${name}"${selected ? ` = "${clip(selected, 60)}"` : ''}${open}`;
    }
    case 'option': {
      const selected = el.getAttribute('aria-selected') === 'true' ? ' [selected]' : '';
      const disabled = el.getAttribute('aria-disabled') === 'true' ? ' [disabled]' : '';
      return `option "${name}"${selected}${disabled}`;
    }
    case 'file': {
      const input = el as HTMLInputElement;
      const traits = [
        input.multiple ? 'several' : '',
        input.accept ? `accepts ${clip(input.accept, 60)}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `file "${name}"${traits ? ` (${traits})` : ''}`;
    }
    default:
      return `${kind.role} "${name}"`;
  }
}

/** How deep open shadow roots are followed. A component inside a component is not a bug, and a
 *  walk with no floor is a tab that stops answering. */
const MAX_SHADOW_DEPTH = 12;

/**
 * Every visible element the outline shows, in document order, descending into OPEN shadow roots.
 * `page.outline`, `page.find` and `page.wait` all walk THIS, so an element find returns is one the
 * outline shows, with the same ref.
 *
 * A host's shadow root is entered where the host is, before the host's own light-DOM children: a
 * reader meets a component's contents where the component is, and those children are slotted content,
 * met where it is written (issue #4).
 *
 * A CLOSED root stays closed, and that is the platform answering rather than a limit worked around:
 * `attachShadow({mode: 'closed'})` is a promise that the inside is unreachable, and `el.shadowRoot`
 * is `null` for it. Nothing here keeps the promise and breaks it; the tool description says so, because
 * an agent that cannot see inside a closed root should ask for another way in.
 */
/** The one document this agent walks. `depth` is 0 in every document now; kept for the type. */
interface Doc {
  doc: Document;
  depth: number;
}

/**
 * This agent's own document, and only that one.
 *
 * It walked same-origin frames itself until issue #32 — `contentDocument` is `null` for a cross-origin
 * one, and that is the browser holding the line. It does not any more: the background now asks EACH
 * frame separately and stitches the answers, which is the only way a cross-origin frame is reachable
 * at all and it gives such a frame the same treatment as a same-origin one instead of making it a
 * special case. Walking in here as well would list a same-origin frame TWICE — once with the local
 * refs and once with the namespaced ones.
 */
function* documents(): Generator<Doc> {
  yield { doc: document, depth: 0 };
}

/**
 * The open modal dialog of a document, if any: the last visible `dialog[open]`, `role=dialog`,
 * `role=alertdialog` or `aria-modal` element. Fluent UI and friends render it in a layer host at
 * the END of `<body>`, so in document order it came last and, with a long page, past the item cap.
 */
function openModal(doc: Document): Element | null {
  let found: Element | null = null;
  for (const el of doc.querySelectorAll(
    'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
  ))
    if (visible(el)) found = el;
  return found;
}

function modalName(modal: Element): string {
  const heading = modal.querySelector('h1, h2, h3, [role="heading"]')?.textContent?.trim();
  const own = modal.getAttribute('aria-label') ?? '';
  const by = modal.getAttribute('aria-labelledby') ? labelFor(modal) : '';
  return clip((own || by || heading || '').trim().replace(/\s+/g, ' '), 80);
}

/** An open modal's controls first, then the rest of the page, each element once. */
function* inDocument(doc: Document): Generator<{ el: Element; kind: Kind }> {
  const modal = openModal(doc);
  const seen = new Set<Element>();
  if (modal)
    for (const item of inTree(modal, doc, 0)) {
      seen.add(item.el);
      yield item;
    }
  for (const item of inTree(doc.body ?? doc.documentElement, doc, 0)) if (!seen.has(item.el)) yield item;
}

function* elements(): Generator<{ el: Element; kind: Kind }> {
  for (const { doc } of documents()) yield* inDocument(doc);
}

/** As `elements`, but each element with the document it lives in — what `outline` and `read` need. */
function* elementsByDocument(): Generator<{ entry: Doc; el: Element; kind: Kind }> {
  for (const entry of documents()) {
    for (const { el, kind } of inDocument(entry.doc)) {
      yield { entry, el, kind };
    }
  }
}

function* inTree(root: ParentNode, doc: Document, depth: number): Generator<{ el: Element; kind: Kind }> {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      SKIP.has((node as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as Element;
    const kind = kindOf(el);
    if (kind && visible(el)) yield { el, kind };
    if (depth < MAX_SHADOW_DEPTH && el.shadowRoot) yield* inTree(el.shadowRoot, doc, depth + 1);
  }
}

function outline(maxItems: number): PageResponse {
  const lines: string[] = [];
  let truncated = false;
  const modal = openModal(document);
  if (modal) lines.push(`dialog "${modalName(modal)}" [modal: its controls are listed first]`);
  // One section per document, headed by the frame's URL rather than running the texts together. A
  // reader cannot see where one embedded document ends and the next begins, and with two frames side
  // by side there is nothing in the text that says which content belongs to which — so every ref in
  // the outline is attributable to a document by looking up from it.
  for (const { el, kind } of elementsByDocument()) {
    if (lines.length >= maxItems) {
      truncated = true;
      break;
    }
    lines.push(
      kind.role === 'heading' ? describe(el, kind) : `[${refOf(el)}] ${describe(el, kind)}${focusMark(el)}`,
    );
  }
  return {
    ok: true,
    data: {
      url: location.href,
      title: document.title,
      outline: lines.join('\n'),
      count: lines.length,
      truncated,
    },
  };
}

/**
 * The text of one block, without the shadow boundary's secrets.
 *
 * `innerText` is computed from the RENDERED output, and a shadow root is rendered — including a
 * CLOSED one, which the page has promised its author is unreachable. So `hostEl.innerText` hands
 * back the contents of a closed root to any content script that asks: the promise holds for
 * `shadowRoot`, and `innerText` walks straight past it. `textContent` stops at the boundary, which
 * is why this is `textContent` and not the prettier one (issue #4).
 *
 * What that costs, stated rather than hidden: `innerText` would also have dropped text that is
 * `visibility: hidden` inside a visible block. That text is reported now. Measuring rendered text
 * without measuring the closed roots would mean measuring the closed roots, which is the one thing
 * this method must not do — and a block that is `display: none` is still left out, because that is
 * the check `visible` does.
 */
function textOf(el: Element): string {
  return el.textContent ?? '';
}

/**
 * The text of a page, as a person reads it (issue: page_read returned script text, not the form).
 *
 * The old version took `textContent` of each top-level block. That is the DOM's text: inline
 * `<script>` and `<style>` bodies count, so a Wiz/Angular page spent the whole `maxChars` budget on
 * code before reaching the first heading, and neighbouring blocks were glued into one word. This walks
 * the rendered tree instead and stops as soon as the budget is spent, so a huge page costs what the
 * answer costs, not what the page weighs.
 *
 * Open shadow roots are entered where their host is; a closed root has no `shadowRoot` and stays
 * closed (issue #4). Slotted light-DOM content is met through its `<slot>`, so it is counted once.
 * Frames are not walked here: the background asks each frame and stitches the answers (issue #32).
 */
function visibleText(maxChars: number): string {
  const out = new TextBuilder(maxChars);
  for (const entry of documents()) {
    if (entry.doc.body) walkText(entry.doc.body, out, 0);
  }
  return out.toString();
}

const MAX_TEXT_DEPTH = 500;

function walkText(node: Node, out: TextBuilder, depth: number): void {
  if (out.full || depth > MAX_TEXT_DEPTH) return;
  if (node.nodeType === Node.TEXT_NODE) {
    out.text(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (TEXT_SKIPPED_TAGS.has(el.tagName.toUpperCase())) return;
  if (el.hasAttribute('hidden') || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true')
    return;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return;

  if (el.localName === 'br') {
    out.block();
    return;
  }
  const sep = separatorOf(style.display, el.localName.includes('-'), el.localName);
  out.boundary(sep);
  const control = controlOf(el);
  if (control !== undefined) {
    out.boundary('space');
    if (control) out.text(control);
    out.boundary('space');
  } else {
    for (const child of childrenToRead(el)) walkText(child, out, depth + 1);
  }
  out.boundary(sep);
}

/** What is rendered inside an element: a host's shadow tree, a slot's assigned nodes, else its children. */
function childrenToRead(el: Element): Node[] {
  if (el.shadowRoot) return [...el.shadowRoot.childNodes];
  if (el.localName === 'slot') {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length) return assigned;
  }
  return [...el.childNodes];
}

/** A form control's shown text ('' for none worth reading), or undefined when `el` is no control. */
function controlOf(el: Element): string | undefined {
  const tag = el.tagName.toUpperCase();
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return undefined;
  const field = el as HTMLInputElement & HTMLSelectElement;
  return (
    controlText({
      tag,
      type: tag === 'INPUT' ? (field.type ?? '').toLowerCase() : '',
      // A password value is never even read: what is not read cannot leak through a later change.
      value: tag === 'SELECT' || (field.type ?? '').toLowerCase() === 'password' ? '' : (field.value ?? ''),
      checked: field.checked === true,
      selected:
        tag === 'SELECT' ? [...field.selectedOptions].map((o) => o.textContent?.trim() ?? '').join(', ') : '',
      placeholder: el.getAttribute('placeholder') ?? '',
      // A visible <label> already names the control; repeating aria-label would say it twice.
      ariaLabel: field.labels?.length ? '' : (el.getAttribute('aria-label') ?? ''),
    }) ?? ''
  );
}

function read(maxChars: number): PageResponse {
  const text = visibleText(maxChars);
  const selection = window.getSelection()?.toString().trim() ?? '';
  return {
    ok: true,
    data: {
      url: location.href,
      title: document.title,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      ...(selection ? { selection: selection.slice(0, maxChars) } : {}),
    },
  };
}

/** Elements matching a query, in document order; `nth` narrows to one. */
function matching(query: ElementQuery, maxResults: number): { matches: Element[]; truncated: boolean } {
  const matches: Element[] = [];
  let seen = 0;
  for (const { el, kind } of elements()) {
    const facts = {
      role: kind.role,
      name: labelFor(el),
      text: (el as HTMLElement).innerText ?? el.textContent ?? '',
    };
    if (!queryMatches(query, facts)) continue;
    if (query.nth !== undefined) {
      if (seen++ === query.nth) return { matches: [el], truncated: false };
      continue;
    }
    if (matches.length >= maxResults) return { matches, truncated: true };
    matches.push(el);
  }
  return { matches, truncated: false };
}

/** `[focus]`, where the keyboard is right now. Without it the focus is invisible from the outside. */
function focusMark(el: Element): string {
  return el.ownerDocument?.activeElement === el ? ' [focus]' : '';
}

/**
 * A ref and what it points at. An element inside a frame says WHICH frame, because a `page_find` on
 * its own cannot tell a button on the page from the same button embedded in someone else's document
 * (issue #30) — and the two are a different thing to click.
 *
 * The focus marker is the same idea for the keyboard: `page_press` without a ref goes wherever the
 * focus is, so an agent that cannot SEE the focus cannot use that form of the call at all — it would
 * be pressing keys into a field it cannot name.
 */
function found(el: Element): { ref: string; description: string } {
  const kind = kindOf(el)!;
  return { ref: refOf(el), description: `${describe(el, kind)}${focusMark(el)}` };
}

function find(query: ElementQuery, maxResults: number): PageResponse {
  const { matches, truncated } = matching(query, maxResults);
  return {
    ok: true,
    data: { url: location.href, matches: matches.map(found), count: matches.length, truncated },
  };
}

/** How many elements a state query may look at. Enough to answer "is it gone yet". */
const EXPECT_MAX_MATCHES = 200;

/**
 * The states one element is actually in.
 *
 * `aria-disabled` counts as disabled even though the DOM property is not set: a control styled and
 * announced as disabled but still clickable is disabled as far as the person reading the screen is
 * concerned, and an assertion that said otherwise would be a false `pass` on a button that does
 * nothing when pressed. Likewise `aria-checked` next to `checked`, for the same reason.
 */
function stateOf(el: Element): Record<string, boolean> {
  const field = el as HTMLInputElement & { disabled?: boolean };
  const ariaDisabled = el.getAttribute('aria-disabled') === 'true';
  const checked = el.getAttribute('aria-checked');
  return {
    visible: visible(el),
    enabled: !field.disabled && !ariaDisabled,
    disabled: Boolean(field.disabled) || ariaDisabled,
    checked: field.checked === true || checked === 'true',
    unchecked: field.checked === false || checked === 'false',
    focused: el.ownerDocument?.activeElement === el,
  };
}

/** What a form control holds; for anything else, what it says. */
function valueOf(el: Element): string {
  const field = el as HTMLInputElement;
  if (typeof field.value === 'string' && 'value' in el) return field.value;
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}

/** One element as the words a failure needs: the states it is in, and what it holds. */
function stateLine(el: Element): string {
  const s = stateOf(el);
  const on = EXPECT_STATES.filter((state) => state !== 'hidden' && s[state]);
  const value = valueOf(el);
  return `${on.join(' ') || 'no state'}${value ? `, value "${clip(value, 60)}"` : ''}`;
}

/**
 * One look at the page: does the condition hold, and if not, what is there instead.
 *
 * The `hidden` case is deliberately about ALL matches and every other state about ANY. "Wait for the
 * spinner to go" is `hidden` on a query that matches one spinner today and none in a moment, and it
 * must not be satisfied by the spinner merely being scrolled out of the viewport. Everything else
 * asks whether the thing is there in that state, and one match is the whole claim.
 */
function checkExpectation(
  req: ExpectRequest,
  query: ElementQuery | undefined,
): {
  pass: boolean;
  seen: string;
  matches: number;
} {
  let els: Element[];
  if (req.ref !== undefined) {
    const el = byRef(req.ref);
    if (!el) return { pass: false, seen: `no element with ref ${req.ref} in this document`, matches: 0 };
    els = [el];
  } else {
    els = matching(query as ElementQuery, EXPECT_MAX_MATCHES).matches;
  }

  const unmet: string[] = [];
  if (req.count !== undefined && els.length !== req.count)
    unmet.push(`found ${els.length}, wanted ${req.count}`);
  if (req.state !== undefined) {
    const want = req.state;
    const holds =
      want === 'hidden' ? !els.some((el) => visible(el)) : els.some((el) => stateOf(el)[want] === true);
    if (!holds) {
      const lines = [...new Set(els.map(stateLine))];
      unmet.push(
        lines.length
          ? `the ${els.length === 1 ? 'element is' : `${els.length} elements are`} ${lines.slice(0, 3).join('; ')}`
          : 'nothing matched the query',
      );
    }
  }
  if (req.value !== undefined && !els.some((el) => valueOf(el) === req.value)) {
    const lines = [...new Set(els.map((el) => `"${clip(valueOf(el), 40)}"`))];
    unmet.push(els.length ? `values are ${lines.slice(0, 3).join(', ')}` : 'nothing matched the query');
  }
  if (req.text !== undefined) {
    const wanted = normalizeText(req.text);
    const has = (el: Element) =>
      normalizeText((el as HTMLElement).innerText ?? el.textContent ?? '').includes(wanted);
    if (!els.some(has))
      unmet.push(
        els.length
          ? `texts are ${[...new Set(els.map((el) => `"${clip((el as HTMLElement).innerText ?? el.textContent ?? '', 40)}"`))].slice(0, 3).join(', ')}`
          : 'nothing matched the query',
      );
  }

  const seen = els.length
    ? els.length === 1
      ? `1 match: ${stateLine(els[0]!)}`
      : `${els.length} matches: ${[...new Set(els.map(stateLine))].slice(0, 3).join('; ')}`
    : 'nothing matched';
  return {
    pass: unmet.length === 0,
    seen: unmet.length ? `${unmet.join(' — ')}` : seen,
    matches: els.length,
  };
}

/**
 * Assert, retrying until it holds or the timeout runs out — the same shape as `waitFor`, because it
 * is the same waiting: a page changes on its own schedule and a condition checked once is a race.
 *
 * A timeout is NOT an error. The answer is `pass: false` with what it saw, because "this never became
 * true" is information the agent acts on, while an exception is something it has to read the message of
 * to learn the same thing.
 */
function expectCondition(req: ExpectRequest, query: ElementQuery | undefined): Promise<PageResponse> {
  const started = Date.now();
  const once = (): PageResponse => {
    const out = checkExpectation(req, query);
    return {
      ok: true,
      data: {
        pass: out.pass,
        expected: expectationOf(req),
        seen: out.seen,
        matches: out.matches,
        waitedMs: Date.now() - started,
      },
    };
  };
  const first = checkExpectation(req, query);
  if (first.pass) return Promise.resolve(once());
  return new Promise((resolve) => {
    let queued = false;
    const done = (): void => {
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(once());
    };
    const check = (): void => {
      queued = false;
      if (checkExpectation(req, query).pass) done();
    };
    // Coalesced, for the same reason as `waitFor`: a page assembling itself fires hundreds of
    // mutations and one check per frame is enough.
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(check, 50);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    const poll = setInterval(check, 250);
    const timer = setTimeout(done, req.timeoutMs);
  });
}

/** A `<meta>` check. Answers a count, never a content (a csrf-token is a meta too). */
function meta(query: MetaQuery): PageResponse {
  let count = 0;
  for (const m of document.querySelectorAll('meta[name]')) {
    const name = m.getAttribute('name') ?? '';
    if (metaMatches(query, { name, content: m.getAttribute('content') ?? '' })) count++;
  }
  return { ok: true, data: { url: location.href, matches: [], count, truncated: false } };
}

/**
 * Wait until an element matching `query` is there — a comment box that becomes an editor after a
 * click, a dialog that opens. A MutationObserver wakes the check on DOM changes; a slow poll
 * covers what it cannot see (an element that becomes visible through a stylesheet or layout
 * alone). Bounded by `timeoutMs`, which the background caps.
 */
function waitFor(query: ElementQuery, timeoutMs: number): Promise<PageResponse> {
  const started = Date.now();
  const hit = () => matching(query, 1).matches[0];
  const first = hit();
  if (first) return Promise.resolve({ ok: true, data: { waitedMs: 0, match: found(first) } });
  return new Promise((resolve) => {
    let queued = false;
    const done = (res: PageResponse) => {
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(res);
    };
    const check = () => {
      queued = false;
      const el = hit();
      if (el) done({ ok: true, data: { waitedMs: Date.now() - started, match: found(el) } });
    };
    // Coalesce bursts of mutations (an editor mounting fires hundreds) into one check per frame.
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(check, 50);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    const poll = setInterval(check, 250);
    const timer = setTimeout(
      () => done({ ok: false, code: 'timeout', message: `nothing matched within ${timeoutMs / 1000} s` }),
      timeoutMs,
    );
  });
}

function notFound(ref: string): PageResponse {
  return {
    ok: false,
    code: 'not_found',
    message: `no element ${ref} on this page — it may have been removed; call page_outline again`,
  };
}

/**
 * Set a form control's value the way a framework-controlled input (React, Angular) will notice.
 *
 * `change` is optional because the two events mean different things: `input` is "the value is
 * different now", `change` is "the value is different AND the field is done". Filling a field fires
 * both, because the call ends there. A single keystroke fires only `input` — firing `change` per
 * character would run a form's change handler once per letter, which is not what typing does.
 */
function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, change = true): void {
  nativeSetValue(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (change) el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The same for a checkbox or a radio: React reads `event.target.checked`, so the setter matters. */
function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(el, checked);
  else el.checked = checked;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Put text into a rich-text editor (CKEditor, ProseMirror, a plain contenteditable).
 *
 * Three steps, and after each the EFFECT is checked — did the text land? — because an editor can
 * swallow an event and change nothing, and "the call returned" is not "the field changed".
 *
 * 1. A synthetic PASTE (Chromium only). It goes through the editor's own clipboard pipeline, so
 *    formatting survives and the editor's undo stack and change events fire as for a real paste.
 *    Firefox cannot do this from an extension, by design: the page's listener gets the event but
 *    `getData()` returns '' for data an extension set (measured, Firefox 155 — first an empty
 *    DataTransfer, then, once filled, types without readable data). So Firefox skips it.
 * 2. `execCommand` insertHTML / insertText — fires beforeinput/input, which editors handle.
 * 3. Plain DOM text, the last resort for a bare contenteditable nothing else reached.
 */
function fillRich(el: HTMLElement, text: string, as: 'text' | 'html', mode: 'replace' | 'append'): boolean {
  const plain = as === 'html' ? htmlToText(text) : text;
  const probe = plain.replace(/\s+/g, ' ').trim().slice(0, 40);
  const landed = () => !probe || (el.innerText ?? '').replace(/\s+/g, ' ').includes(probe);
  const select = () => {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    if (mode === 'append') range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const firefox = 'wrappedJSObject' in window;
  if (!firefox) {
    select();
    el.dispatchEvent(pasteEvent(as === 'html' ? text : null, plain));
    if (landed()) return true;
  }
  select();
  document.execCommand(as === 'html' ? 'insertHTML' : 'insertText', false, text);
  if (landed()) return true;
  // The same events a typed insertion sends, so an editor listening for `beforeinput` still hears it.
  el.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      composed: true,
      cancelable: true,
      inputType: 'insertText',
      data: plain,
    }),
  );
  if (mode === 'replace') el.textContent = '';
  el.append(plain);
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: plain }),
  );
  return landed();
}

/**
 * The browser calls `typeInto` needs (field-fill.ts). The read-back asks the field, and the element
 * with the keyboard when the field is gone: a framework that re-renders swaps the input for a new one
 * and gives it the focus, and the old node then holds nothing.
 */
const fieldEnv: FillEnv<HTMLInputElement | HTMLTextAreaElement> = {
  setValue: nativeSetValue,
  read: (el) => {
    if (el.isConnected) return el.value;
    const active = deepActive(document);
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active.value
      : el.value;
  },
  input: (type, inputType, data) =>
    new InputEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: type === 'beforeinput',
      inputType,
      data,
    }),
  key: (type, key) => new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true }),
  change: () => new Event('change', { bubbles: true }),
};

function pasteEvent(html: string | null, plain: string): ClipboardEvent {
  const data = new DataTransfer();
  if (html !== null) data.setData('text/html', html);
  data.setData('text/plain', plain);
  return new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.innerText ?? doc.body.textContent ?? '';
}

function fill(ref: string, text: string, as: 'text' | 'html', mode: 'replace' | 'append'): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const kind = kindOf(el);
  if (el instanceof HTMLInputElement && el.type === 'password') {
    return {
      ok: false,
      code: 'invalid',
      message: 'password fields are never filled — the person types those',
    };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const plain = as === 'html' ? htmlToText(text) : text;
    // What comes back is `stuck`/`length`, never the value: it may be a secret.
    return {
      ok: true,
      data: { ref, ...typeInto(el, mode === 'append' ? el.value + plain : plain, fieldEnv) },
    };
  }
  if (kind?.role === 'richtext' || (el as HTMLElement).isContentEditable) {
    const stuck = fillRich(el as HTMLElement, text, as, mode);
    return {
      ok: true,
      data: { ref, stuck, retried: false, length: ((el as HTMLElement).innerText ?? '').length },
    };
  }
  return {
    ok: false,
    code: 'invalid',
    message: `${ref} is not a text field (${kind?.role ?? el.tagName.toLowerCase()})`,
  };
}

/**
 * Type a one-time code the person relayed (ADR 0020), into a field the page marks as one.
 *
 * The guard's rules live in core (`refuseCodeField`); this only reads the facts off the element.
 * Nothing it returns or throws holds the code: the answer is the field's ref and the length.
 */
function enterCode(ref: string, raw: string): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const parsed = parseOneTimeCode(raw);
  if ('error' in parsed) return { ok: false, code: 'invalid', message: parsed.error };
  const refusal = refuseCodeField({
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type.toLowerCase() : '',
    autocomplete: el.getAttribute('autocomplete') ?? '',
    inputmode: el.getAttribute('inputmode') ?? '',
    words: [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), labelFor(el)]
      .filter(Boolean)
      .join(' '),
  });
  if (refusal) return { ok: false, code: 'invalid', message: refusal };
  if (!(el instanceof HTMLInputElement)) return notFound(ref);
  el.focus();
  setNativeValue(el, parsed.code);
  return { ok: true, data: { ref, length: parsed.code.length } };
}

/** Every file field under `root`, open shadow roots included (a design system keeps its input there). */
function fileInputsUnder(root: ParentNode, depth = 0): HTMLInputElement[] {
  const found = [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  if (depth >= MAX_SHADOW_DEPTH) return found;
  for (const node of root.querySelectorAll('*'))
    if (node.shadowRoot) found.push(...fileInputsUnder(node.shadowRoot, depth + 1));
  return found;
}

/**
 * The file field a ref stands for: the field itself, the one a label points at, or the only one
 * near a button that opens it. A page that hides its `<input type=file>` behind a styled button
 * leaves no formal link, so the nearest ancestor holding exactly one is the answer; two of them is
 * a guess nobody should make for the person, so that is refused instead.
 *
 * It tells "no file field belongs to this" (a drop zone: the page makes its input on click, or has
 * none) from "several might".
 */
function fileInputLookup(el: Element): { input: HTMLInputElement | null; ambiguous: boolean } {
  const isFile = (e: Element | null | undefined): e is HTMLInputElement =>
    e instanceof HTMLInputElement && e.type === 'file';
  if (isFile(el)) return { input: el, ambiguous: false };
  if (el instanceof HTMLLabelElement && isFile(el.control)) return { input: el.control, ambiguous: false };
  const wrapping = el.closest('label');
  if (wrapping && isFile(wrapping.control)) return { input: wrapping.control, ambiguous: false };
  // A button inside an open shadow root (a design system's `<x-button>`) has no parent element at
  // the root of its shadow tree; the walk steps out through the host instead of stopping there.
  const up = (e: Element): Element | null => e.parentElement ?? (e.getRootNode() as ShadowRoot).host ?? null;
  let at: Element | null = el;
  for (let i = 0; at && i < 4; i++, at = at ? up(at) : null) {
    // The whole document is not "near" anything: stopping here is what lets a drop zone, which owns
    // no field, be told from a button whose field sits beside it.
    if (at === document.body || at === document.documentElement) break;
    const found = fileInputsUnder(at);
    if (found.length === 1) return { input: found[0]!, ambiguous: false };
    if (found.length > 1) return { input: null, ambiguous: true };
  }
  return { input: null, ambiguous: false };
}

/** Does the file match an `accept` attribute: `.pdf`, `image/*`, `application/pdf`? Empty accepts all. */
function accepts(accept: string, name: string, mime: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const lower = name.toLowerCase();
  return tokens.some((t) =>
    t.startsWith('.') ? lower.endsWith(t) : t.endsWith('/*') ? mime.startsWith(t.slice(0, -1)) : mime === t,
  );
}

/**
 * Put files into a file field the way a person's choice in the picker does: the field's `files`
 * set, then `input` and `change`. The bytes arrive from the bridge (ADR 0027) and are never
 * returned; the answer is name, size and type per file, as the PAGE now holds them.
 */
async function upload(ref: string, files: UploadFile[]): Promise<PageResponse> {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const { input, ambiguous } = fileInputLookup(el);
  if (ambiguous)
    return {
      ok: false,
      code: 'invalid',
      message: `${ref} is not a file field, and no single file field belongs to it`,
    };
  if (files.length === 0) return { ok: false, code: 'invalid', message: 'no files given' };
  if (!input) {
    const lazy = await openChooser(el);
    if (!lazy) return dropFiles(el, ref, files);
    try {
      return fillInput(lazy, ref, files);
    } finally {
      lazy.removeAttribute(CHOOSER_MARK);
      if (lazy.parentElement?.hasAttribute(CHOOSER_BOX)) lazy.parentElement.remove();
    }
  }
  return fillInput(input, ref, files);
}

/**
 * A button whose handler makes a file input on the spot and calls `input.click()` on it owns no field
 * we could find. The page-world hook (chooser-hook.ts) keeps such a click from opening a chooser and
 * parks the input in the DOM while the document is armed; this clicks the button and takes it.
 * Chromium's hook is installed by the background (`world: MAIN`); Firefox's here, through the page's
 * compartment. Null when the click produced no file input: then the element is a drop zone.
 */
async function openChooser(el: Element): Promise<HTMLInputElement | null> {
  const page = (window as unknown as { wrappedJSObject?: unknown }).wrappedJSObject;
  if (page) installChooserHook(page as HookWindow);
  const root = document.documentElement;
  root.setAttribute(CHOOSER_ARMED, '');
  try {
    (el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'center' });
    (el as HTMLElement).click();
    for (let i = 0; i < 6; i++) {
      const got = document.querySelector<HTMLInputElement>(`input[type="file"][${CHOOSER_MARK}]`);
      if (got) return got;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  } finally {
    root.removeAttribute(CHOOSER_ARMED);
  }
}

function fillInput(input: HTMLInputElement, ref: string, files: UploadFile[]): PageResponse {
  if (input.disabled) return { ok: false, code: 'invalid', message: 'the file field is disabled' };
  if (files.length > 1 && !input.multiple)
    return { ok: false, code: 'invalid', message: 'the file field takes one file, not several' };
  const refused = files.find((f) => !accepts(input.accept, f.name, f.mime));
  if (refused)
    return {
      ok: false,
      code: 'invalid',
      message: `the file field accepts ${input.accept}, so "${refused.name}" is not allowed`,
    };
  const transfer = new DataTransfer();
  for (const f of buildFiles(files)) transfer.items.add(f);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const held = Array.from(input.files ?? []);
  return {
    ok: true,
    data: {
      ref,
      via: 'input',
      files: held.map((f) => ({ name: f.name, mime: f.type, size: f.size })),
      accepted: held.length === files.length,
    },
  };
}

function buildFiles(files: UploadFile[]): File[] {
  return files.map((f) => {
    const binary = atob(f.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], f.name, { type: f.mime });
  });
}

/**
 * A drop zone with no file field to fill: deliver the files the way dragging them in would, as
 * dragenter, dragover and drop on the element, with a DataTransfer that holds the File objects.
 *
 * What `accepted` means here is weaker than for a field, and the answer says so with `via: "drop"`:
 * a page cannot be asked whether it kept the files, only whether it took the drop, which a drop
 * handler says by cancelling the event (`preventDefault`). A page that reads `event.dataTransfer`
 * and does not cancel looks refused here though it took the files.
 *
 * Firefox: a File or DataTransfer built here carries the extension's principal, and the page's
 * `dataTransfer.files` silently filters those out (the listener runs, the list is empty). So on
 * Firefox the bytes, the Files, the DataTransfer and the events are built in the PAGE's compartment
 * through `window.wrappedJSObject`, with `cloneInto` for what crosses. Chromium's isolated world
 * needs none of that.
 */
function dropFiles(el: Element, ref: string, files: UploadFile[]): PageResponse {
  const built = buildFiles(files);
  type Ctor = new (...args: unknown[]) => unknown;
  const world = (window as unknown as { wrappedJSObject?: Record<string, Ctor> }).wrappedJSObject;
  const clone = (globalThis as unknown as { cloneInto?: (v: unknown, w: unknown, o?: unknown) => unknown })
    .cloneInto;
  const inPage = world && clone;
  let transfer: DataTransfer;
  if (inPage) {
    transfer = new world.DataTransfer!() as DataTransfer;
    for (const f of files) {
      const binary = atob(f.base64);
      const bytes = new world.Uint8Array!(binary.length) as unknown as Uint8Array;
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const parts = new world.Array!() as unknown as unknown[];
      parts.push(bytes);
      const opts = new world.Object!() as unknown as { type: string };
      opts.type = f.mime;
      const file = new world.File!(parts, f.name, opts);
      transfer.items.add(file as File);
    }
  } else {
    transfer = new DataTransfer();
    for (const f of built) transfer.items.add(f);
  }
  (el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const fire = (type: 'dragenter' | 'dragover' | 'drop'): boolean => {
    const init = { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, ...at };
    let event: DragEvent;
    if (inPage) {
      // Built field by field in the page's compartment: a content-script object handed to the
      // page's constructor is unreadable there ("Permission denied to access property").
      const pageInit = new world.Object!() as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(init)) pageInit[key] = value;
      event = new world.DragEvent!(type, pageInit) as unknown as DragEvent;
    } else event = new DragEvent(type, init);
    el.dispatchEvent(event);
    return event.defaultPrevented;
  };
  fire('dragenter');
  fire('dragover');
  const taken = fire('drop');
  return {
    ok: true,
    data: {
      ref,
      via: 'drop',
      files: built.map((f) => ({ name: f.name, mime: f.type, size: f.size })),
      accepted: taken,
    },
  };
}

function click(ref: string, fallback = false): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const target = el as HTMLElement;
  if (fallback) {
    // The retry for a custom element that ignored the pointer events: only its own `click()` works.
    if (!target.isConnected) return { ok: false, code: 'failed', message: `${ref} is no longer in the page` };
    target.click();
    return { ok: true, data: { ref } };
  }
  const plan = planClick(target, { width: window.innerWidth, height: window.innerHeight });
  if (!plan.ok) return { ok: false, code: 'failed', message: `${ref}: ${plan.message}` };
  target.focus?.();
  pointerClick(target, plan, (type, at) => {
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, ...at };
    const down = type === 'pointerdown' || type === 'mousedown' ? { buttons: 1 } : {};
    if (type === 'click') return new MouseEvent('click', init);
    return type.startsWith('pointer')
      ? new PointerEvent(type, { ...init, ...down })
      : new MouseEvent(type, { ...init, ...down });
  });
  // Whether a retry with `click()` is allowed is decided here, where the element is known.
  return { ok: true, data: { ref, fallbackOk: fallbackEligible(target, plan.hit) } };
}

/**
 * Send a key, and do what the browser would have done with it.
 *
 * The honest limit first, because it shapes everything here: an event created in a content script
 * and dispatched on the page is UNTRUSTED, and an untrusted key event performs NO default action.
 * A real Enter submits the form, a real character appears in the field, a real Tab moves the focus.
 * Dispatching `new KeyboardEvent('keydown', …)` does none of that — it only reaches the page's own
 * listeners, which is enough for a widget that listens (a hotkey, a combobox, a code editor, a
 * game) and for nothing else.
 *
 * So beifahrer does the second half itself, per key, where the browser's own behaviour is defined
 * and reproducible: it inserts the text, moves the selection, submits the form, focuses the next
 * element, toggles the box. That is not a simulation of the keyboard; it is the list of things a
 * key does that a page cannot be relied upon to do for itself. What stays out is deliberately:
 *
 * - Any key whose effect only the BROWSER can have (Ctrl+T, Alt+F4, the back gesture, a print
 *   dialog, anything in browser chrome). Those are refused by name rather than sent and ignored.
 * - Modifier-only presses. Nobody pressing Control wants an action; they want the next key with it,
 *   and the page gets `ctrlKey: true` on that one.
 *
 * Why not refuse the whole method as untrusted and leave the person to press keys? Because the
 * common case is a page that listens — and for that, an untrusted event is indistinguishable from
 * a real one. The rest is a documented approximation, and `page_evaluate` (ADR 0012) is the honest
 * answer when even this is not enough.
 */

/** Keys that belong to the browser, not to the page. Refused rather than silently ignored. */
const BROWSER_KEYS = new Set([
  'F11',
  'F12',
  'PrintScreen',
  'ScrollLock',
  'Pause',
  'BrowserBack',
  'BrowserForward',
  'BrowserHome',
  'BrowserSearch',
  'BrowserFavorites',
  'ContextMenu',
]);

/**
 * The options of a real `<select>`, or the ARIA options of a dropdown built from divs.
 *
 * Both are returned because the refusal below needs to NAME what the choices are — an agent told
 * only "not a select" has to go and read the page to find out what it missed. What it may not do
 * is set `selected` on the second kind: a div has no selected state, so the widget would look
 * chosen while the page's own model never heard of it. For that, `page_click` on the option is the
 * real mechanism and the honest instruction.
 */
function selectOptions(el: Element): { options: HTMLOptionElement[]; settable: boolean } {
  if (el instanceof HTMLSelectElement) return { options: [...el.options], settable: true };
  const aria = [...el.querySelectorAll<HTMLElement>('[role="option"]')];
  if (el.getAttribute('role') === 'listbox' && aria.length > 0)
    return { options: aria as unknown as HTMLOptionElement[], settable: false };
  return { options: [], settable: false };
}

function press(
  ref: string | undefined,
  keyName: string | undefined,
  text: string | undefined,
  times: number,
): PageResponse {
  // Checked HERE as well as in the handler, because a script reaches this function directly and the
  // handler is not in the path. "Press a, then type b" has no defined order between the two, and
  // picking one would be a keystroke neither the caller nor the person in the confirm window was
  // shown; a call with neither presses nothing and must not answer "done".
  if (keyName !== undefined && text !== undefined) {
    return { ok: false, code: 'invalid', message: 'press takes a key OR text, not both' };
  }
  if (keyName === undefined && text === undefined) {
    return { ok: false, code: 'invalid', message: 'press needs a key or text — one of the two' };
  }
  // Where the keys go: the element the caller named, or whatever the page already has focused —
  // which is what a person pressing a key does, and is the only way to reach a widget that took
  // focus itself (a date picker that opened, a search field that grabbed the keyboard).
  const el = ref ? byRef(ref) : (document.activeElement as Element | null);
  if (ref && !el) return notFound(ref);
  const target = el ?? document.body;
  if (target instanceof HTMLInputElement && target.type === 'password') {
    return {
      ok: false,
      code: 'invalid',
      message: 'password fields are never typed into — the person types those',
    };
  }
  if (target instanceof HTMLInputElement) target.scrollIntoView({ block: 'center', inline: 'center' });
  if (typeof (target as HTMLElement).focus === 'function') (target as HTMLElement).focus();

  if (text !== undefined) return typeText(target, text, times);
  const parsed = parseKeySpec(keyName);
  if (typeof parsed === 'string') return { ok: false, code: 'invalid', message: parsed };
  if (BROWSER_KEYS.has(parsed.key)) {
    return {
      ok: false,
      code: 'invalid',
      message: `${parsed.key} belongs to the browser, not to the page — Beifahrer cannot press it`,
    };
  }
  for (let i = 0; i < times; i++) sendKey(target, parsed);
  return { ok: true, data: { ref: ref ?? null, key: parsed.spec, times } };
}

/** The three events, in the order the standard says, then what the key would have done. */
function sendKey(el: Element, key: KeySpec): void {
  const base = {
    key: key.key,
    code: key.code ?? '',
    keyCode: key.keyCode,
    which: key.keyCode,
    altKey: key.alt,
    ctrlKey: key.ctrl,
    metaKey: key.meta,
    shiftKey: key.shift,
    bubbles: true,
    cancelable: true,
    composed: true,
    // A page that checks these reads the real modifiers, and gets the truth.
    getModifierState: (name: string) =>
      name === 'Alt'
        ? key.alt
        : name === 'Control'
          ? key.ctrl
          : name === 'Meta'
            ? key.meta
            : name === 'Shift'
              ? key.shift
              : false,
  };
  // cancelable matters: a page that calls preventDefault() on the keydown is claiming the key, and
  // beifahrer's own default action must then not happen — otherwise the page handles Enter and
  // beifahrer submits the form a second time.
  const down = new KeyboardEvent('keydown', base);
  const handled = !el.dispatchEvent(down);
  if (key.text !== undefined && !handled) {
    el.dispatchEvent(new KeyboardEvent('keypress', { ...base, cancelable: false }));
  }
  if (!handled) defaultAction(el, key);
  el.dispatchEvent(new KeyboardEvent('keyup', base));
}

/**
 * What the browser would have done, for the keys whose effect beifahrer can reproduce.
 *
 * This is the part that makes `press` more than a page listener, and every branch here is a
 * documented platform behaviour rather than a guess about the site: Enter submits a form, Tab moves
 * to the next focusable element, a character goes into the field, Backspace deletes the selection.
 */
function defaultAction(el: Element, key: KeySpec): void {
  const field = editableField(el);
  switch (key.key) {
    case 'Enter': {
      if (field) {
        if (field instanceof HTMLTextAreaElement) {
          // A newline, the one place Enter does not submit.
          replaceValue(
            field,
            insertAtCaret(field.value, field.selectionStart ?? 0, field.selectionEnd ?? 0, '\n'),
            'insertLineBreak',
          );
          return;
        }
        // Enter in a text input submits the form it is in — and only then: the spec's "implicit
        // submission" needs a form with a submit button, or exactly one field.
        const form = field.form;
        if (form && (form.requestSubmit || form.submit)) {
          (form.requestSubmit ? form.requestSubmit.bind(form) : form.submit.bind(form))();
          return;
        }
        // No form: a person pressing Enter in a bare field does nothing at all. Not a click.
        return;
      }
      // Enter on a button or a link is a click. That is what a person means by it.
      if (isActivatable(el)) (el as HTMLElement).click();
      return;
    }
    case 'Tab': {
      focusSibling(el, key.shift);
      return;
    }
    case 'Space': {
      if (isActivatable(el) || isCheckable(el)) {
        (el as HTMLElement).click();
        return;
      }
      // In a text field, Space is a character like any other. This branch exists because the
      // switch handles Space as a NAMED key first, and without it the space was simply dropped —
      // the call returned and the field looked exactly as it had before.
      if (key.text !== undefined && field) {
        replaceValue(
          field,
          insertAtCaret(field.value, field.selectionStart ?? 0, field.selectionEnd ?? 0, ' '),
        );
      }
      return;
    }
    case 'Backspace':
    case 'Delete': {
      if (!field) return;
      const start = field.selectionStart ?? 0;
      const end = field.selectionEnd ?? start;
      const backspace = key.key === 'Backspace';
      // A selection collapses first; otherwise one character goes, in the direction asked for.
      const how = backspace ? 'deleteContentBackward' : 'deleteContentForward';
      if (start !== end) deleteRange(field, start, end, how);
      else if (backspace && start > 0) deleteRange(field, start - 1, start, how);
      else if (!backspace && end < field.value.length) deleteRange(field, end, end + 1, how);
      return;
    }
    default:
      // A printable character into a text field. A contenteditable is not a text control and is
      // not reached here: `fillRich` owns those, and typing into one with the caret arithmetic
      // below would fight the editor that owns the selection.
      if (key.text !== undefined && field) {
        replaceValue(
          field,
          insertAtCaret(field.value, field.selectionStart ?? 0, field.selectionEnd ?? 0, key.text),
          'insertText',
          key.text,
        );
      }
  }
}

function deleteRange(
  field: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  how: 'deleteContentBackward' | 'deleteContentForward',
): void {
  const caret = start;
  // A surrogate pair is ONE character to the person and two units to JavaScript. Deleting half of
  // one leaves a broken glyph behind, and the field then holds something no key sequence produces.
  const first = field.value.charCodeAt(start);
  if (start === end && start > 0 && first >= 0xdc00 && first <= 0xdfff) start -= 1;
  if (replaceValue(field, field.value.slice(0, start) + field.value.slice(end), how))
    field.setSelectionRange?.(caret, caret);
}

function insertAtCaret(value: string, start: number, end: number, text: string): string {
  return value.slice(0, start) + text + value.slice(end);
}

/**
 * Set the value and tell the page, in the order the platform does it: `beforeinput` (cancelable —
 * a widget may refuse the edit), then the value, then `input`.
 *
 * `beforeinput` is where a masked field or a character counter gets to say no. Dispatching it and
 * ignoring the answer would make a widget that limits input to digits accept letters, which is
 * exactly the kind of lie a write method must not tell.
 */
function replaceValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  inputType:
    | 'insertText'
    | 'insertLineBreak'
    | 'deleteContentBackward'
    | 'deleteContentForward' = 'insertText',
  /** The one character typed, for `beforeinput.data`. Absent for a newline or a deletion. */
  text?: string,
): boolean {
  const event = new InputEvent('beforeinput', {
    inputType,
    // `data` is the CHARACTER that was typed, not the whole new value: a page that counts
    // characters or masks a field reads this, and handing it the field's entire contents would make
    // every keystroke look like a paste of everything typed before it. null for a deletion.
    data: inputType === 'insertText' ? text : null,
    bubbles: true,
    cancelable: true,
  });
  // Cancelable, and honoured: a masked field or a character counter says no here, and a write that
  // ignored the refusal would make a digits-only field accept letters.
  if (!field.dispatchEvent(event)) return false;
  setNativeValue(field, value, false);
  return true;
}

/** Type text one character at a time, so a listener that reacts per character sees each one. */
function typeText(target: Element, text: string, times: number): PageResponse {
  for (let round = 0; round < times; round++)
    for (const ch of text) {
      const spec = parseKeySpec(ch);
      if (typeof spec === 'string') return { ok: false, code: 'invalid', message: spec };
      sendKey(target, spec);
    }
  return { ok: true, data: { ref: null, text, times } };
}

/** The text control a key types into, or null when the target is not one. */
function editableField(el: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) return el;
  return null;
}

function isActivatable(el: Element): boolean {
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return true;
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return true;
  const role = el.getAttribute('role');
  return role === 'button' || role === 'link' || el.tagName === 'SUMMARY';
}

function isCheckable(el: Element): boolean {
  const role = el.getAttribute('role');
  return role === 'checkbox' || role === 'switch' || role === 'radio' || el.hasAttribute('aria-checked');
}

/**
 * Tab: the next element a person could reach, in the order the browser would pick.
 *
 * The focusable set is the standard one (what it is, then what it may be reached by), taken from
 * the element's OWN document — which is where a same-origin frame's fields live (issue #30) — and
 * it wraps at both ends, because Tab in a browser wraps too. Positive `tabindex` is ordered ahead
 * of the rest, ascending, as the spec says; a page that uses it and gets it wrong would send focus
 * somewhere surprising, which is worse than not moving it at all.
 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, details > summary, [tabindex], [contenteditable="true"]';

function focusSibling(from: Element, back: boolean): void {
  const doc = from.ownerDocument ?? document;
  const all = [...doc.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1' && visible(el),
  );
  if (all.length === 0) return;
  const positive = all.filter((el) => Number(el.getAttribute('tabindex')) > 0);
  const ordered = [
    ...positive.sort((a, b) => numAttr(a) - numAttr(b)),
    ...all.filter((el) => !positive.includes(el)),
  ];
  const at = ordered.indexOf(from as HTMLElement);
  // A target that is not itself focusable (a ref on a wrapper) still moves from where focus IS.
  const current = at >= 0 ? at : activeIndex(ordered);
  const next = back
    ? (current <= 0 ? ordered.length : current) - 1
    : current < 0 || current >= ordered.length - 1
      ? 0
      : current + 1;
  ordered[next]?.focus();
}

const numAttr = (el: HTMLElement): number => Number(el.getAttribute('tabindex')) || 0;

/** Where in the focusable list the document's focus is now, so Tab from a wrapper still works. */
function activeIndex(ordered: HTMLElement[]): number {
  const active = ordered.find((el) => el === (ordered[0]?.ownerDocument?.activeElement ?? null));
  return active ? ordered.indexOf(active) : -1;
}

function select(ref: string, values: string[], add: boolean): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const { options, settable } = selectOptions(el);
  const names = options
    .slice(0, 20)
    .map((o) => (o.textContent ?? '').trim() || o.value)
    .filter(Boolean)
    .join(', ');
  if (!settable) {
    return {
      ok: false,
      code: 'invalid',
      message:
        `${ref} is not a <select>, so it has no options to set. ` +
        (names ? `Its choices are: ${names}. ` : '') +
        'Click the combobox with page_click, then page_click the option (page_find role "option") — a dropdown built from divs changes only when it is clicked.',
    };
  }
  const wanted: HTMLOptionElement[] = [];
  for (const value of values) {
    // By value first, then by the text a person reads: an agent knows the label from the outline
    // and the value from nothing, so the readable one has to work too.
    const hit =
      options.find((o) => o.value === value) ??
      options.find((o) => (o.textContent ?? '').trim() === value) ??
      options.find((o) => (o.getAttribute('aria-label') ?? '').trim() === value);
    if (!hit) {
      // Naming what IS there is the whole point: an agent that gets the list can choose again,
      // while one that gets "not found" has to go and read the page to find out what it missed.
      return {
        ok: false,
        code: 'invalid',
        message: `no option "${value}" in ${ref}. Available: ${names || '(all empty)'}`,
      };
    }
    if (!wanted.includes(hit)) wanted.push(hit);
  }
  // A single select holds ONE value. Setting two leaves the DOM with the last one, and answering
  // with the whole list would be a confident lie: the agent builds its next step on a state the page
  // does not have. `add` means "keep what is chosen", which is the multi-select's own way of saying
  // the same thing, so a single select has no reading of it and it is refused there too.
  if (!add && wanted.length > 1 && !(el instanceof HTMLSelectElement && el.multiple)) {
    return {
      ok: false,
      code: 'invalid',
      message: `${ref} holds one value at a time — choose one of ${wanted
        .map((o) => (o.textContent ?? '').trim() || o.value)
        .join(', ')}, or use a <select multiple>.`,
    };
  }
  if (!add) for (const o of options) o.selected = false;
  for (const o of wanted) o.selected = true;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const chosen = wanted.map((o) => (o.textContent ?? '').trim() || o.value);
  return { ok: true, data: { ref, selected: chosen } };
}

function check(ref: string, checked: boolean): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (el.disabled) return { ok: false, code: 'invalid', message: `${ref} is disabled` };
    if (el.checked === checked) {
      return { ok: true, data: { ref, checked: el.checked, changed: false } };
    }
    setNativeChecked(el, checked);
    return { ok: true, data: { ref, checked: el.checked, changed: true } };
  }
  // An ARIA checkbox is a div with a click handler and an attribute the page owns. Setting
  // `aria-checked` by hand would make it LOOK toggled while the page's state model never heard of
  // it — the classic fake. So it is clicked, and the answer is read back from the attribute: if
  // the click did not land, the answer says so instead of reporting a state that is not there.
  if (isCheckable(el) || isActivatable(el)) {
    if (ariaChecked(el) === checked) return { ok: true, data: { ref, checked, changed: false } };
    (el as HTMLElement).click();
    const now = ariaChecked(el);
    if (now === null) return { ok: true, data: { ref, clicked: true } };
    if (now !== checked) {
      return {
        ok: false,
        code: 'failed',
        message: `clicking ${ref} left it ${now ? 'checked' : 'unchecked'} — the widget answers something else`,
      };
    }
    return { ok: true, data: { ref, checked: now, changed: true } };
  }
  return {
    ok: false,
    code: 'invalid',
    message: `${ref} is not a checkbox (${kindOf(el)?.role ?? el.tagName.toLowerCase()})`,
  };
}

/** What a widget says about itself, or null when it says nothing (a plain input is `checked`). */
function ariaChecked(el: Element): boolean | null {
  const attr = el.getAttribute('aria-checked');
  return attr === null ? null : attr === 'true';
}

/**
 * The pill says what is happening: reading for read/outline/find/meta/wait, editing for
 * describe/fill/click.
 */
/**
 * A document the page links to, fetched in the page's own session.
 *
 * Bounded by what the tab already is: same origin only. A download is the one place where a
 * string the agent supplied turns into a request, so it may not reach anywhere the person did
 * not already browse to. The bytes travel back over the loopback bridge; nothing is written to
 * disk here, so the person's download folder stays theirs and no file appears they did not ask
 * for.
 *
 * Reading only: no click, no form, no confirmation — fetching a document must never be a way to
 * act on the account it came from.
 */
async function download(
  ref: string | undefined,
  url: string | undefined,
  maxBytes: number,
): Promise<PageResponse> {
  let target: string | undefined;
  if (ref) {
    const el = byRef(ref);
    if (!el) return notFound(ref);
    const href = (el as HTMLAnchorElement).href;
    if (!href) return { ok: false, code: 'invalid', message: `${ref} is not a link` };
    target = href;
  } else {
    target = url;
  }

  // Where it may reach is decided in core, so the bound is testable without a browser.
  const resolved = resolveDownloadTarget(target, location.href);
  if (!resolved.ok) {
    // Another origin is not this document's call: say where the link points and let the extension
    // judge it (policy, sister origin, the person's rule). Anything else stays refused here.
    if (resolved.reason === 'cross-origin' && target) {
      try {
        const there = new URL(target, location.href);
        if (there.protocol === 'https:' || there.protocol === 'http:')
          return { ok: true, data: { elsewhere: there.href } };
      } catch {
        // Falls through to the refusal below.
      }
    }
    return { ok: false, code: 'invalid', message: resolved.message };
  }

  let res: Response;
  try {
    res = await fetch(resolved.url, { credentials: 'include', redirect: 'follow' });
  } catch (err) {
    return { ok: false, code: 'failed', message: `the page could not fetch it: ${(err as Error).message}` };
  }
  if (!res.ok) return { ok: false, code: 'failed', message: `the site answered ${res.status}` };

  // Content-Length is a hint, not a promise: it may be absent, and on a chunked answer it lies.
  // It is checked first so an oversized file is refused before it is in memory, and the measured
  // size decides afterwards.
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, code: 'invalid', message: `${declared} bytes, over the ${maxBytes} limit` };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    return { ok: false, code: 'invalid', message: `${buf.byteLength} bytes, over the ${maxBytes} limit` };
  }

  return {
    ok: true,
    data: {
      url: resolved.url,
      filename: downloadFilename(res.headers.get('content-disposition'), resolved.url),
      mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(),
      size: buf.byteLength,
      base64: toBase64(buf),
    },
  };
}

/**
 * Is this element a row of a list? A table row with data cells, a list item, an ARIA row or
 * list item, or a framework's row component (`app-document-list-item`, `x-row`): a custom element
 * whose name ends in `-item` or `-row`. A role-less row has no entry in the outline, which is why
 * lists get a method of their own (ADR 0018).
 */
function isRowElement(el: Element): boolean {
  const tag = el.tagName;
  const role = el.getAttribute('role');
  if (el.closest('nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"]')) return false;
  if (tag === 'TR') return el.querySelector('td, [role="cell"], [role="gridcell"]') !== null;
  if (role === 'row') return el.querySelector('td, [role="cell"], [role="gridcell"]') !== null;
  if (tag === 'LI' || role === 'listitem' || role === 'option') return true;
  const name = tag.toLowerCase();
  return name.includes('-') && /-(item|row)$/.test(name);
}

/** The outermost visible rows of the document, in order, through open shadow roots. */
function collectRows(): Element[] {
  const out: Element[] = [];
  const walk = (parent: ParentNode, depth: number): void => {
    for (const child of Array.from(parent.children)) {
      if (SKIP.has(child.tagName)) continue;
      if (isRowElement(child) && visible(child)) {
        out.push(child);
        continue;
      }
      if (depth < MAX_SHADOW_DEPTH && child.shadowRoot) walk(child.shadowRoot, depth + 1);
      walk(child, depth);
    }
  };
  for (const { doc } of documents()) walk(doc.body ?? doc.documentElement, 0);
  return out;
}

function scrollerOf(el: Element | undefined): HTMLElement {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

const ROWS_BUDGET_MS = 20_000;
/** How long a scroll step may take to show other rows; background tabs run timers about 1 s apart. */
const ROWS_SETTLE_MS = 3_000;
/** Once rows changed, how long they must stay the same before the next step. */
const ROWS_QUIET_MS = 250;

/** Does a row reach the bottom edge of what the person sees? If not, the list has yet to render this part. */
function filled(scroller: HTMLElement, root: HTMLElement): boolean {
  const bottom = scroller === root ? innerHeight : scroller.getBoundingClientRect().bottom;
  return collectRows().some((el) => el.getBoundingClientRect().bottom >= bottom - 1);
}

function rowsSignature(): string {
  return collectRows()
    .map((el) => clip(textOf(el), 40))
    .join('\n');
}

/**
 * The rows of the list in front of the person, scrolled through from the top.
 *
 * A virtual-scroll list renders only what is on screen and recycles the elements, so the text of
 * every row is gathered as it passes and only the row that was asked for (`match`) comes back with a
 * ref — the others are gone from the DOM by the time the scroll ends. Without `match` the scroll
 * position is put back where it was. Rows with the same text count once.
 */
/** A candidate this small cannot be a QR code a phone could scan from a screen. */
const QR_MIN_SIDE = 80;
/** Large enough for a decoder to see the modules, small enough to cross the message channel. */
const QR_RENDER = 400;
const QR_MAX_CANDIDATES = 6;

function qrLabel(el: Element): string {
  return [
    el.getAttribute('alt'),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.id,
    el.getAttribute('class'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** An <svg> drawn as an image, so that it can be rasterized like an <img>. Null if the browser refuses. */
function svgImage(svg: SVGElement): Promise<HTMLImageElement | null> {
  const source = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

/**
 * The pixels of every image-like element big enough to be a QR code, for the extension to decode
 * (ADR 0022). Pixels, not text: the decoder lives in the background, so this script, which is
 * injected into every tab the agent touches, does not carry it. A cross-origin image taints the
 * canvas and is skipped; the count says how many were, so a failure can name the reason.
 *
 * The page's own pixels are read, never a screenshot: nothing here needs the tab to be active.
 */
async function qrPixels(names: string[] | undefined): Promise<PageResponse> {
  const wanted = (names ?? []).map((n) => n.toLowerCase()).filter(Boolean);
  const elements = [...document.querySelectorAll('img, canvas, svg')].filter((el) => {
    const box = el.getBoundingClientRect();
    if (box.width < QR_MIN_SIDE || box.height < QR_MIN_SIDE) return false;
    if (wanted.length === 0) return true;
    const label = qrLabel(el);
    return wanted.some((n) => label.includes(n));
  });
  const candidates: { width: number; height: number; rgba: string }[] = [];
  let unreadable = 0;
  for (const el of elements.slice(0, QR_MAX_CANDIDATES)) {
    const source = el instanceof SVGElement ? await svgImage(el) : (el as CanvasImageSource);
    const w =
      el instanceof HTMLImageElement
        ? el.naturalWidth
        : el instanceof HTMLCanvasElement
          ? el.width
          : el.getBoundingClientRect().width;
    const h =
      el instanceof HTMLImageElement
        ? el.naturalHeight
        : el instanceof HTMLCanvasElement
          ? el.height
          : el.getBoundingClientRect().height;
    if (!source || !w || !h) {
      unreadable++;
      continue;
    }
    const scale = QR_RENDER / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      unreadable++;
      continue;
    }
    // Transparent pixels would read as black; a QR code is dark on light.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      candidates.push({
        width: data.width,
        height: data.height,
        rgba: toBase64(new Uint8Array(data.data.buffer)),
      });
    } catch {
      unreadable++;
    }
  }
  return { ok: true, data: { candidates, unreadable, seen: elements.length } };
}

async function rows(match: string | undefined, maxRows: number): Promise<PageResponse> {
  const wanted = match ? normalizeText(match) : '';
  const seen = new Set<string>();
  const list: { index: number; text: string }[] = [];
  let hit: Element | undefined;
  let truncated = false;

  const take = (): boolean => {
    for (const el of collectRows()) {
      const text = clip(textOf(el), 200);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      list.push({ index: list.length, text });
      if (wanted && normalizeText(text).includes(wanted)) {
        hit = el;
        return true;
      }
      if (list.length >= maxRows) {
        truncated = true;
        return true;
      }
    }
    return false;
  };

  const first = collectRows()[0];
  let scroller = scrollerOf(first);
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const origin = scroller.scrollTop;
  const started = Date.now();
  scroller.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 60));
  // A list that loads more when its end is reached grows AFTER the scroll, later than a fixed pause
  // (issue #143). At the end, wait a bounded time for the height to grow before calling it the end.
  // 3 s, not less: the agent often works in a background tab, where the browser throttles timers to
  // about 1 s, so the page's own load-more and this loop's 100 ms steps both run slow. ROWS_BUDGET_MS
  // still bounds the whole call.
  const GROW_WAIT_MS = 3_000;
  for (let step = 0; step < 400 && Date.now() - started < ROWS_BUDGET_MS; step++) {
    if (take()) break;
    const before = scroller.scrollTop;
    const heightBefore = scroller.scrollHeight;
    scroller.scrollTop = before + Math.max(scroller.clientHeight * 0.8, 100);
    // A list may render or grow only after scrolling paused, later than any fixed pause. So wait until
    // rows or height CHANGE, take them at every change (a virtual list recycles its elements), and go
    // on once they have been quiet. No change inside the window means the step brought nothing; the
    // window is longest at the end, where a load-more fires. Bounded by ROWS_BUDGET_MS in any case.
    const atEnd = scroller.scrollTop + scroller.clientHeight >= heightBefore - 4;
    const window = atEnd ? GROW_WAIT_MS : filled(scroller, root) ? 300 : ROWS_SETTLE_MS;
    const signature = (): string => `${scroller.scrollHeight}|${rowsSignature()}`;
    let last = signature();
    let changedAt = 0;
    const settleStart = Date.now();
    await new Promise((r) => setTimeout(r, 120));
    let done = false;
    while (!done && Date.now() - settleStart < window && Date.now() - started < ROWS_BUDGET_MS) {
      const now = signature();
      if (now !== last) {
        last = now;
        changedAt = Date.now();
        done = take();
      } else if (changedAt && Date.now() - changedAt >= ROWS_QUIET_MS) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (done) break;
    if (scroller.scrollTop === before) {
      // The chosen element does not move: the page itself may be the scroller (issue #143).
      if (scroller !== root) {
        scroller = root;
        continue;
      }
      take();
      break;
    }
  }
  if (!hit) scroller.scrollTop = origin;
  return {
    ok: true,
    data: { rows: list, count: list.length, truncated, ...(hit ? { ref: refOf(hit) } : {}) },
  };
}

/** The armed capture: the first link the page clicked by itself that a download may follow. */
let armed: { stop: () => void; href?: string } | undefined;

/**
 * Click something that hands over a document, and note the link the page clicks in answer.
 *
 * A portal's "Download" button usually has no href: it asks its API for a ticket and then clicks an
 * anchor it made. A DOM click event is visible here whoever dispatched it, so the anchor is seen,
 * and its default action is cancelled — the browser must not fetch a one-time ticket the agent is
 * about to fetch (ADR 0018). Only a link that `resolveDownloadTarget` allows is touched, and only
 * one the page clicked after our click or one marked `download`/`blob:`; a link the person's click
 * would follow anyway is left alone.
 */
function armCapture(ref: string): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  armed?.stop();
  const state: { stop: () => void; href?: string } = { stop: () => {} };
  const onClick = (ev: Event): void => {
    const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || state.href) return;
    const own = a === el || a.contains(el) || el.contains(a);
    const download = a.hasAttribute('download') || a.href.startsWith('blob:');
    // The clicked link itself: a file link the browser would save on its own, a second copy of what
    // capture is about to fetch. A link that opens a new tab stays the tab path's business.
    if (own && !download && a.target === '_blank') return;
    const target = resolveDownloadTarget(a.href, location.href);
    if (target.ok) state.href = target.url;
    else if (target.reason === 'cross-origin' && /^https?:/.test(a.href)) state.href = a.href;
    else return;
    ev.preventDefault();
  };
  document.addEventListener('click', onClick, true);
  state.stop = () => document.removeEventListener('click', onClick, true);
  armed = state;
  (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
  (el as HTMLElement).focus?.();
  (el as HTMLElement).click();
  return { ok: true, data: { ref } };
}

async function captured(waitMs: number, disarm: boolean): Promise<PageResponse> {
  const until = Date.now() + waitMs;
  while (armed && !armed.href && !disarm && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  const href = armed?.href;
  if (href || disarm) {
    armed?.stop();
    armed = undefined;
  }
  return { ok: true, data: { href: href ?? null } };
}

/** `String.fromCharCode(...bytes)` blows the stack on a real document, so it goes in chunks. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * What a script gets in scope as `beifahrer`, beside the DOM (ADR 0012).
 *
 * Deliberately the same verbs a recipe has — find, click, fill, read, outline — so a script reads
 * like a recipe and never has to guess how a widget is put together. Every one of them goes
 * through the code path the equivalent call uses; the gate for all of them was checked once, for
 * the script, in the confirm window the person answered.
 */
interface ScriptApi {
  readonly url: string;
  readonly title: string;
  find(query: ElementQuery, maxResults?: number): FoundElement[];
  describe(ref: string): string;
  click(ref: string): void;
  fill(ref: string, text: string, as?: 'text' | 'html', mode?: 'replace' | 'append'): string;
  press(ref: string | undefined, key?: string, text?: string, times?: number): void;
  select(ref: string, values: string[], add?: boolean): string[];
  check(ref: string, checked?: boolean): boolean | void;
  read(maxChars?: number): string;
  outline(maxItems?: number): string;
  meta(query: MetaQuery): number;
  sleep(ms: number): Promise<void>;
}

function scriptApi(): ScriptApi {
  const query = (raw: ElementQuery): ElementQuery => {
    const parsed = parseElementQuery(raw);
    if (typeof parsed === 'string') throw new Error(parsed);
    return parsed;
  };
  const unwrap = (res: PageResponse): Record<string, unknown> => {
    if (!res.ok) throw new Error(res.message);
    return res.data;
  };
  return {
    url: location.href,
    title: document.title,
    find: (q, maxResults = 20) => {
      const { matches } = matching(query(q), maxResults);
      return matches.map(found);
    },
    describe: (ref) => String(unwrap(describeRef(ref)).description),
    click: (ref) => void click(ref),
    fill: (ref, text, as = 'text', mode = 'replace') => String(unwrap(fill(ref, text, as, mode)).value),
    press: (ref, key, text, times) => void unwrap(press(ref, key, text, times ?? 1)),
    select: (ref, values, add) => (unwrap(select(ref, values, add === true)).selected as string[]) ?? [],
    check: (ref, checked) => unwrap(check(ref, checked !== false)).checked as boolean | void,
    read: (maxChars = 4_000) => String(unwrap(read(maxChars)).text),
    outline: (maxItems = 200) => String(unwrap(outline(maxItems)).outline),
    meta: (q) => {
      const parsed = parseMetaQuery(q);
      if (typeof parsed === 'string') throw new Error(parsed);
      return Number(unwrap(meta(parsed)).count ?? 0);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 0), 30_000))),
  };
}

/** The page agent's `describe`, as a value: a script wants the text, not a response envelope. */
function describeRef(ref: string): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  const kind = kindOf(el);
  return {
    ok: true,
    data: { ref, description: kind ? describe(el, kind) : el.tagName.toLowerCase() },
  };
}

/**
 * Run the agent's own code here (ADR 0012).
 *
 * The script is the BODY of an async function, so `return` gives a result and `await` works
 * without ceremony. What comes back is projected into JSON-safe, bounded data by `projectValue`
 * (core), with a `truncated` flag the agent must not ignore: a result that lost part of itself is
 * not the whole answer.
 *
 * What a script CANNOT do, and why that is the design rather than a limitation to work around:
 * it cannot reach the page's JavaScript objects. This runs in the page agent's isolated world, and
 * no WebExtension can run agent-supplied code in a page's own world without defeating the page's
 * CSP (a `<script>` element) — so beifahrer does not offer that, and the handler refuses
 * `world: "main"` rather than pretending. `world: "main"` exists in the type for the day a browser
 * offers it properly.
 *
 * A script that never returns cannot be stopped from here: it holds the tab's main thread, and the
 * person closes or reloads the tab. That is stated in the ADR and in the tool description rather
 * than hidden behind a timeout that cannot fire.
 */
type ScriptRunner = (...args: unknown[]) => unknown;

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
  ...args: string[]
) => ScriptRunner;

/**
 * What a script must not see, even for the length of one call.
 *
 * A content script's isolated world carries the EXTENSION's own APIs as globals: `chrome` (or
 * `browser`), and through it `storage.local` — which holds the pairing token, the whole per-origin
 * policy, the feature switches and the pause flag (settings.ts). A script that could read them
 * could clear the pause and widen every level, so it would be able to un-gate every later call in
 * this browser: one approved run would unmake the whole model (ADR 0012).
 *
 * The shadowing is by PARAMETER, not by deleting anything. A parameter named `chrome` shadows the
 * global for the whole body without touching the page agent's own reference to it, which is what
 * lets `browser.runtime.onMessage` below keep working while a script runs. `globalThis` is shadowed
 * as well, so the script cannot reach the real object by property path either.
 *
 * What this does NOT claim: it is not a sandbox boundary in the JS-engine sense. The script still
 * runs in this realm and can reach anything reachable from a realm global that is not named here.
 * The narrow list below plus the isolated world is what stands between a script and the extension.
 * It is the reason the capability is off by default, confirmed every time, and limited to sites at
 * `write` — not a reason to relax any of those.
 */
const SHADOWED = ['chrome', 'browser', 'globalThis', 'self', 'top', 'parent', 'frames', 'opener'] as const;

function scriptParams(): string[] {
  return ['beifahrer', ...SHADOWED];
}

function scriptArgs(api: ScriptApi): unknown[] {
  // `self`, `top`, `parent`, `frames` and `opener` still WORK as the page's own window (a script
  // needs `location` and `document`); they are shadowed so the script cannot walk from them to the
  // extension's frame. `window` is not shadowed for the same reason.
  return [api, undefined, undefined, undefined, window, window, window, window, window];
}

/**
 * Can this browser compile a string into a function HERE, in a content script?
 *
 * Measured, not assumed, because the answer is a property of the platform and it differs:
 *
 * - A Manifest V2 content script has NO content security policy of its own, so `new Function` works
 *   (Firefox, and Firefox's Manifest V2 build of beifahrer).
 * - A Manifest V3 content script SHARES the extension's policy, and that policy cannot be relaxed:
 *   Chrome refuses to install an extension whose `content_security_policy.extension_pages` contains
 *   `'unsafe-eval'`, and only `self`, `none`, `wasm-unsafe-eval` and — unpacked only — localhost are
 *   allowed there. So on Chromium, and on any Manifest V3 build, the call throws.
 *
 * The two doors around it are not ours to open: Chromium's `userScripts` API needs *Allow user
 * scripts* turned on for the extension (developer mode), and `chrome.debugger` attaches a debugger
 * to the person's browser. So a script is answered `unsupported` there, with the reason, rather than
 * faked — the same answer `world: "main"` gets, for a second and independent reason (ADR 0012).
 *
 * Probed once and remembered: the answer cannot change while the page lives.
 */
let canCompile: boolean | undefined;

function codeExecutionAllowed(): boolean {
  canCompile ??= (() => {
    try {
      new Function('');
      return true;
    } catch {
      return false;
    }
  })();
  return canCompile;
}

/**
 * The refusal, naming the place it came from. The background answers the same failure differently —
 * it knows the manifest version and CANNOT measure the fact — so this one says what the content
 * script found where the script would have run. That is what lets an agent tell "this browser
 * cannot" from "the person has not allowed it", which are different problems with different next
 * moves (issue #31).
 */
function noCodeHere(): string {
  const mv = browser.runtime.getManifest().manifest_version;
  return (
    'Beifahrer will not run a script in this page: in Manifest V3 a content script shares the ' +
    "extension's content security policy, and that policy cannot name 'unsafe-eval' — Chrome " +
    `refuses to install an extension that tries. This browser reports Manifest V${mv}, and the ` +
    'probe here failed where the script would have run. Firefox (Manifest V2) runs scripts.'
  );
}

async function evaluate(script: string, maxChars: number): Promise<PageResponse> {
  if (!codeExecutionAllowed()) return { ok: false, code: 'unsupported', message: noCodeHere() };
  const names = scriptParams();
  let run: ScriptRunner;
  try {
    // `new AsyncFunction` is the whole point of this method: the script is agent-supplied code by
    // definition. Bounded by `parseEvaluate` (length), shown whole in the confirm window, and the
    // extension's own APIs are shadowed out of the scope below.
    run = new AsyncFunction(...names, `"use strict";\n${script}`);
  } catch (err) {
    return { ok: false, code: 'invalid', message: `the script does not compile: ${scriptError(err)}` };
  }
  const token = beginScript();
  const api = guardApi(scriptApi(), token);
  const args = scriptArgs(api);
  try {
    const { value, truncated } = projectValue(await run(...args), maxChars);
    return { ok: true, data: { url: location.href, world: 'isolated', value, truncated } };
  } catch (err) {
    return { ok: false, code: 'failed', message: `the script failed: ${scriptError(err)}` };
  } finally {
    endScript(token);
  }
}

/**
 * The stops a script can reach.
 *
 * A synchronous `while (true)` holds the tab's main thread and nothing on this side can interrupt
 * it — that is a platform fact and the tool description says so. An ASYNC script is different: it
 * yields at every `await`, so `beifahrer.sleep` can refuse, and pause is checked between steps.
 * A fire-and-forget async script therefore still cannot click forever after its call ended: its
 * next `beifahrer.*` call throws, because the run it belonged to is over.
 */
function guardApi(api: ScriptApi, token: number): ScriptApi {
  const check = (): void => {
    if (!scriptAlive(token))
      throw new Error(
        'this script is no longer running — Beifahrer was paused, or the call it belonged to has ended',
      );
  };
  return {
    ...api,
    find: (...args) => {
      check();
      return api.find(...args);
    },
    describe: (...args) => {
      check();
      return api.describe(...args);
    },
    click: (...args) => {
      check();
      return api.click(...args);
    },
    fill: (...args) => {
      check();
      return api.fill(...args);
    },
    press: (...args) => {
      check();
      return api.press(...args);
    },
    select: (...args) => {
      check();
      return api.select(...args);
    },
    check: (...args) => {
      check();
      return api.check(...args);
    },
    read: (...args) => {
      check();
      return api.read(...args);
    },
    outline: (...args) => {
      check();
      return api.outline(...args);
    },
    meta: (...args) => {
      check();
      return api.meta(...args);
    },
    sleep: (ms) => interruptibleSleep(ms, token),
  };
}

const VERB: Partial<Record<PageRequest['beifahrer'], 'reading' | 'editing'>> = {
  read: 'reading',
  outline: 'reading',
  find: 'reading',
  meta: 'reading',
  wait: 'reading',
  // An assertion reads the page like `find` does, so the pill says so — a person watching the page
  // must be able to tell "the agent is looking" from "the agent is not".
  expect: 'reading',
  download: 'reading',
  rows: 'reading',
  qr: 'reading',
  capture: 'editing',
  captured: 'reading',
  describe: 'editing',
  fill: 'editing',
  click: 'editing',
  upload: 'editing',
  // press, select and check are `editing` for the same reason fill is: they change the page.
  press: 'editing',
  select: 'editing',
  check: 'editing',
  evaluate: 'editing',
};

/**
 * How many frame elements this document holds.
 *
 * A count, and it is the count the top document can give for frames it may not read: the ELEMENTS
 * are visible across origins, their contents are not. The extension uses it to know how many
 * announcements to wait for after injecting into every frame, instead of guessing with a sleep — a
 * fixed wait would be either too short on a page with thirty frames or too long on a page with none.
 */
function frameCount(): number {
  return document.querySelectorAll('iframe, frame').length;
}

/**
 * The document's mutation counter, created by the first `probe` or `quiet` request and never before:
 * a page nobody acts on pays nothing for it.
 */
let actProbe: MutationProbe | undefined;
function probeOf(): MutationProbe {
  actProbe ??= new MutationProbe({
    doc: document as unknown as ProbeDocument,
    Observer: MutationObserver,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    id: crypto.randomUUID(),
    url: () => location.href,
    // The pill is ours, not the page's doing.
    ignore: (node) => node.nodeName.toLowerCase() === HOST_TAG,
  });
  return actProbe;
}

function handle(req: PageRequest): PageResponse | Promise<PageResponse> {
  const verb = VERB[req.beifahrer];
  session = req.session;
  // Shown BEFORE reading: `read` takes body.innerText, and the pill lives outside <body> in a
  // closed shadow root, so it never shows up in what the agent gets.
  if (verb) show(verb, req.session, inFrame);
  switch (req.beifahrer) {
    case 'find':
      return find(req.query, req.maxResults);
    case 'meta':
      return meta(req.meta);
    case 'wait':
      return waitFor(req.query, req.timeoutMs);
    case 'expect':
      return expectCondition(req, req.query);
    case 'read':
      return read(req.maxChars);
    case 'outline':
      return outline(req.maxItems);
    case 'download':
      return download(req.ref, req.url, req.maxBytes);
    case 'rows':
      return rows(req.match, req.maxRows);
    case 'qr':
      return qrPixels(req.name);
    case 'capture':
      return armCapture(req.ref);
    case 'captured':
      return captured(req.waitMs, req.disarm === true);
    case 'describe': {
      const el = byRef(req.ref);
      if (!el) return notFound(req.ref);
      const kind = kindOf(el);
      return {
        ok: true,
        data: { ref: req.ref, description: kind ? describe(el, kind) : el.tagName.toLowerCase() },
      };
    }
    case 'fill':
      return fill(req.ref, req.text, req.as, req.mode);
    case 'enterCode':
      return enterCode(req.ref, req.code);
    case 'upload':
      return upload(req.ref, req.files);
    case 'where':
      // Read fresh, every time. This is the only answer the policy is decided on, so it must not
      // come from a value remembered at injection time — a frame that navigated since then would be
      // gated on the origin it used to have.
      return { ok: true, data: { url: location.href } };
    case 'probe':
      return {
        ok: true,
        data: { ...probeOf().snapshot(), f: formState(req.ref ? (byRef(req.ref) as never) : null) },
      };
    case 'quiet':
      return probeOf()
        .quiet(req.quietMs, req.maxMs)
        .then((q) => ({ ok: true as const, data: { ...q } }));
    case 'click':
      return click(req.ref, req.fallback === true);
    case 'press':
      return press(req.ref, req.key, req.text, req.times);
    case 'select':
      return select(req.ref, req.values, req.add);
    case 'check':
      return check(req.ref, req.checked);
    case 'evaluate':
      return evaluate(req.script, req.maxChars);
    case 'hide':
      hideNow();
      return { ok: true, data: {} };
  }
}

/** Every answer carries the frame count, so the extension knows when it has heard from them all. */
function withFrameCount(res: PageResponse): PageResponse {
  if (res.ok) return { ok: true, data: { ...res.data, frames: frameCount() } };
  return res;
}

/**
 * Say where this document is — on EVERY injection, not only the first (issue #32).
 *
 * The extension pairs this with the browser's own `frameId`, and that pairing is what teaches it a
 * frame exists at all. The URL in here is a HINT, not the authority: it is whatever `location.href`
 * happened to be when the extension injected, which for a frame still loading is `about:blank`. The
 * authority is the `where` request below, asked again immediately before each policy decision.
 *
 * The message asks for nothing and returns nothing, so a page cannot learn from it that beifahrer is
 * here: it goes to the extension, not to the page. Re-announcing costs one message per injection per
 * frame, and a frame that has navigated since the last call is found again rather than trusted.
 */
function announceFrame(): Promise<number> {
  // The browser tells the background which frame this message came from, and the background tells
  // US — in the reply. Knowing our own number is what lets every frame ignore a request meant for a
  // different one.
  //
  // Why that matters, and it is not belt-and-braces: `tabs.sendMessage` with a `frameId` is the
  // obvious way to address a frame, and it did not reach one here. A request that went to all frames
  // and was answered by whichever was quicker is a race that resolves wrongly in a WRITE, so the
  // address travels IN the request and each frame drops what is not for it. `frameId` and
  // `documentId` are kept as well where the browser has them — they are the cheaper path when they
  // work — but correctness no longer depends on either.
  return browser.runtime
    .sendMessage({ type: FRAME_HELLO, url: location.href })
    .then((answer: unknown) => {
      const id = (answer as { frame?: unknown } | null)?.frame;
      return typeof id === 'number' ? id : window === window.top ? 0 : -1;
    })
    .catch(() => (window === window.top ? 0 : -1));
}

// The listener is installed once per document; the announcement is not.
const listening = globalThis as { __beifahrerListening?: boolean };
if (!listening.__beifahrerListening) {
  listening.__beifahrerListening = true;
  // Resolves with this document's own frame number. Every request waits for it, because a frame that
  // cannot say whether it is the one being asked must not answer: answering when it is not the
  // addressee is how a write lands in the wrong document.
  const myFrame = announceFrame();
  const onRequest = (message: unknown): PageResponse | Promise<PageResponse | undefined> | undefined => {
    const req = message as PageRequest | null;
    if (!req || typeof req !== 'object' || !('beifahrer' in req)) return undefined;
    if (req.frame !== undefined) {
      const mine = myFrame;
      return mine.then((id) => {
        // `-1` means the background never told us, and a frame that does not know its own number
        // answers nothing rather than everything.
        if (id < 0 || id !== req.frame) return undefined;
        return answer(req as PageRequest);
      });
    }
    return answer(req as PageRequest);
  };
  browser.runtime.onMessage.addListener(onRequest);
  // Safari never delivers `tabs.sendMessage` to a script injected with `scripting.executeScript`
  // (measured on Safari 27.0.1: a listener saw 0 of 5 messages), but `executeScript` with a `func`
  // returns the result. inject.ts asks through this hook there. The isolated world keeps it out of
  // the page's reach.
  (globalThis as { __beifahrerAsk?: typeof onRequest }).__beifahrerAsk = onRequest;
}

/** The whole request handling, once the addressee question is settled. */
function answer(req: PageRequest): PageResponse | Promise<PageResponse> | undefined {
  // The DOM calls in here throw on hostile or unusual pages (a detached range, a
  // `DataTransfer` the page's CSP forbids). An exception escaping a message listener does not
  // reach the sender — it would see "no answer" and lose the reason — so it is answered.
  try {
    const res = handle(req);
    // Before a screenshot: answer only once a frame without the pill is on screen.
    if (req.beifahrer === 'hide') return afterRepaint().then(() => res);
    return Promise.resolve(res instanceof Promise ? res : withFrameCount(res));
  } catch (err) {
    return Promise.resolve({ ok: false, code: 'failed', message: String((err as Error)?.message ?? err) });
  }
}
