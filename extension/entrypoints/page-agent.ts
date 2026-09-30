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
  downloadFilename,
  metaMatches,
  parseElementQuery,
  parseMetaQuery,
  projectValue,
  queryMatches,
  resolveDownloadTarget,
  scriptError,
  type ElementQuery,
  type FoundElement,
  type MetaQuery,
} from '@beifahrer/core';
import { afterRepaint, hideNow, keepShown, show } from '../src/page-indicator.ts';
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

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function visible(el: Element): boolean {
  if (el.closest('[aria-hidden="true"], [hidden]')) return false;
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
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
  return el.getAttribute('title') ?? el.getAttribute('name') ?? el.getAttribute('alt') ?? '';
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
        | 'tab'
        | 'menuitem';
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
  if (role === 'checkbox') return { role: 'checkbox' };
  if (role === 'tab') return { role: 'tab' };
  if (role === 'menuitem') return { role: 'menuitem' };
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

/** `beifahrer.sleep`, but it wakes on a run that is over: beifahrer paused, or the call replaced. */
function interruptibleSleep(ms: number, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (!scriptAlive(token)) {
        reject(new Error('beifahrer was paused or the script was replaced — it stopped here'));
        return;
      }
      // The pill and its Stop button must survive a script that is running: it is the one control
      // the person has while it does. Re-asserted on every tick rather than once (page-indicator).
      keepShown('editing', session);
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
      const href = (el as HTMLAnchorElement).href;
      return `link "${name}" → ${clip(href, 120)}`;
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
      return `combobox "${name}"${selected ? ` = "${clip(selected, 60)}"` : ''}`;
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
/** How deep frames are followed. Nesting three deep is a layout; ten deep is a mistake. */
const MAX_FRAME_DEPTH = 3;

/** One document the walk visits, and how it got there. */
interface Doc {
  doc: Document;
  /** The frame element it was reached through; absent for the page's own document. */
  via?: Element;
  depth: number;
  /** What to call it in the outline: where it is, not where it came from. */
  label?: string;
}

/**
 * The page's own document, then every same-origin frame in it, in the order the frames sit (issue
 * #30).
 *
 * `contentDocument` is `null` for a cross-origin frame. That is the browser holding the line, and it
 * is the whole reason this needs no new policy: a cross-origin frame belongs to a DIFFERENT origin,
 * the one whose `read` the person never gave. Granting the page does not grant the frames inside it,
 * and `all_frames` in the manifest would have granted them by accident — that is issue #32, and it is
 * a different, larger decision.
 */
function* documents(root: Document = document, depth = 0, via?: Element): Generator<Doc> {
  yield { doc: root, depth, via, ...frameLabel(via) };
  if (depth >= MAX_FRAME_DEPTH) return;
  for (const frame of frameElements(root)) {
    const inner = (frame as HTMLIFrameElement).contentDocument;
    // No body yet, or gone: a frame that never loaded or was torn down. Not an error, just nothing
    // to read — and asking again later is how `page_wait` for a frame works.
    if (!inner?.body) continue;
    yield* documents(inner, depth + 1, frame);
  }
}

/** Where a frame is, for the outline. The live location, because `src` goes stale on a redirect. */
function frameLabel(via?: Element): { label?: string } {
  if (!via) return {};
  const href = (via as HTMLIFrameElement).contentWindow?.location?.href ?? via.getAttribute('src');
  return { label: href ?? 'about:blank' };
}

/** The frame elements in a document, including the ones inside open shadow roots (issue #4). */
function* frameElements(root: Document | ShadowRoot): Generator<Element> {
  for (const el of root.querySelectorAll('iframe, frame')) yield el;
  for (const shadow of openRootsIn(root, 0)) {
    for (const el of shadow.querySelectorAll('iframe, frame')) yield el;
  }
}

function* elements(): Generator<{ el: Element; kind: Kind }> {
  for (const { doc } of documents()) yield* inTree(doc.body ?? doc.documentElement, doc, 0);
}

/** As `elements`, but each element with the document it lives in — what `outline` and `read` need. */
function* elementsByDocument(): Generator<{ entry: Doc; el: Element; kind: Kind }> {
  for (const entry of documents()) {
    for (const { el, kind } of inTree(entry.doc.body ?? entry.doc.documentElement, entry.doc, 0)) {
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

/** The heading that separates one document from the next in an outline or a read (issue #30). */
const FRAME_MARK = '— frame: ';

function outline(maxItems: number): PageResponse {
  const lines: string[] = [];
  let truncated = false;
  // One section per document, headed by the frame's URL rather than running the texts together. A
  // reader cannot see where one embedded document ends and the next begins, and with two frames side
  // by side there is nothing in the text that says which content belongs to which — so every ref in
  // the outline is attributable to a document by looking up from it.
  let current: Doc | undefined;
  for (const { entry, el, kind } of elementsByDocument()) {
    if (entry !== current) {
      current = entry;
      if (entry.label) lines.push(`${FRAME_MARK}${entry.label}`);
    }
    if (lines.length >= maxItems) {
      truncated = true;
      break;
    }
    lines.push(kind.role === 'heading' ? describe(el, kind) : `[${refOf(el)}] ${describe(el, kind)}`);
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
 * The text of a page, in the order a person meets it.
 *
 * `body.innerText` stops at the shadow boundary, so a page built from web components would be read
 * as its own chrome with the interface missing. Each top-level block contributes its own text and
 * then whatever open shadow roots it hosts — a reader meets a block's text and the things that block
 * renders together. Only the roots' OWN children are taken: slotted content lives in the host's light
 * DOM, is already part of the block's text, and would otherwise be counted twice. A closed root
 * contributes nothing, for the same reason the walk cannot see it (issue #4).
 */
function visibleText(): string {
  const parts: string[] = [];
  for (const entry of documents()) {
    // A frame's text is introduced by the same marker the outline uses, because two frames side by
    // side produce two texts that are visually adjacent and not one text: running them together
    // destroys the arrangement AND invents an order the page never had (issue #30).
    if (entry.label) parts.push(FRAME_MARK + entry.label);
    parts.push(...documentText(entry.doc));
  }
  return parts
    .filter((part) => part.trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text of one document: its own blocks, and what its open shadow roots render. */
function documentText(doc: Document): string[] {
  const parts: string[] = [];
  for (const node of doc.body?.childNodes ?? []) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (!visible(el)) continue;
      parts.push(textOf(el));
      for (const shadow of openRootsIn(el, 0)) {
        for (const child of shadow.children) {
          if (visible(child)) parts.push(textOf(child));
        }
      }
    } else if (node.textContent?.trim()) {
      parts.push(node.textContent);
    }
  }
  return parts;
}

/**
 * The open shadow roots inside a light-DOM subtree, INCLUDING the subtree's own element, in document
 * order.
 *
 * The element itself first, because that is the common case and the one `querySelectorAll('*')`
 * cannot answer: a host's shadow root is not a DESCENDANT in the light DOM, so searching only among
 * the children misses the root of the very element you started from — the one case that is not a
 * nested component at all.
 */
function* openRootsIn(el: Element | ShadowRoot | Document, depth: number): Generator<ShadowRoot> {
  if (depth >= MAX_SHADOW_DEPTH) return;
  const host = 'shadowRoot' in el ? el : null;
  if (host?.shadowRoot) {
    yield host.shadowRoot;
    yield* openRootsIn(host.shadowRoot, depth + 1);
  }
  for (const node of el.querySelectorAll('*')) {
    const shadow = node.shadowRoot;
    if (!shadow) continue;
    yield shadow;
    yield* openRootsIn(shadow, depth + 1);
  }
}

function read(maxChars: number): PageResponse {
  const text = visibleText();
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

/**
 * A ref and what it points at. An element inside a frame says WHICH frame, because a `page_find` on
 * its own cannot tell a button on the page from the same button embedded in someone else's document
 * (issue #30) — and the two are a different thing to click.
 */
function found(el: Element): { ref: string; description: string } {
  const kind = kindOf(el)!;
  const frame = frameOf(el);
  const where = frame ? ` [frame: ${frame}]` : '';
  return { ref: refOf(el), description: `${describe(el, kind)}${where}` };
}

/** The label of the document an element is in, or '' for the page's own. */
function frameOf(el: Element): string {
  for (const entry of documents()) {
    if (entry.label && entry.doc.contains(el)) return entry.label;
  }
  return '';
}

function find(query: ElementQuery, maxResults: number): PageResponse {
  const { matches, truncated } = matching(query, maxResults);
  return {
    ok: true,
    data: { url: location.href, matches: matches.map(found), count: matches.length, truncated },
  };
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

/** Set a form control's value the way a framework-controlled input (React, Angular) will notice. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
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
function fillRich(el: HTMLElement, text: string, as: 'text' | 'html', mode: 'replace' | 'append'): void {
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
    if (landed()) return;
  }
  select();
  document.execCommand(as === 'html' ? 'insertHTML' : 'insertText', false, text);
  if (landed()) return;
  if (mode === 'replace') el.textContent = '';
  el.append(plain);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

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
    el.focus();
    const plain = as === 'html' ? htmlToText(text) : text;
    setNativeValue(el, mode === 'append' ? el.value + plain : plain);
    return { ok: true, data: { ref, value: clip(el.value, 2000) } };
  }
  if (kind?.role === 'richtext' || (el as HTMLElement).isContentEditable) {
    fillRich(el as HTMLElement, text, as, mode);
    return { ok: true, data: { ref, value: clip((el as HTMLElement).innerText ?? '', 2000) } };
  }
  return {
    ok: false,
    code: 'invalid',
    message: `${ref} is not a text field (${kind?.role ?? el.tagName.toLowerCase()})`,
  };
}

function click(ref: string): PageResponse {
  const el = byRef(ref);
  if (!el) return notFound(ref);
  (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
  (el as HTMLElement).focus?.();
  (el as HTMLElement).click();
  return { ok: true, data: { ref } };
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
  if (!resolved.ok) return { ok: false, code: 'invalid', message: resolved.message };

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
    'beifahrer will not run a script in this page: in Manifest V3 a content script shares the ' +
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
        'this script is no longer running — beifahrer was paused, or the call it belonged to has ended',
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
  download: 'reading',
  describe: 'editing',
  fill: 'editing',
  click: 'editing',
  evaluate: 'editing',
};

function handle(req: PageRequest): PageResponse | Promise<PageResponse> {
  const verb = VERB[req.beifahrer];
  session = req.session;
  // Shown BEFORE reading: `read` takes body.innerText, and the pill lives outside <body> in a
  // closed shadow root, so it never shows up in what the agent gets.
  if (verb) show(verb, req.session);
  switch (req.beifahrer) {
    case 'find':
      return find(req.query, req.maxResults);
    case 'meta':
      return meta(req.meta);
    case 'wait':
      return waitFor(req.query, req.timeoutMs);
    case 'read':
      return read(req.maxChars);
    case 'outline':
      return outline(req.maxItems);
    case 'download':
      return download(req.ref, req.url, req.maxBytes);
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
    case 'click':
      return click(req.ref);
    case 'evaluate':
      return evaluate(req.script, req.maxChars);
    case 'hide':
      hideNow();
      return { ok: true, data: {} };
  }
}

// Injected before every request; the listener must be installed once per document.
const listening = globalThis as { __beifahrerListening?: boolean };
if (!listening.__beifahrerListening) {
  listening.__beifahrerListening = true;
  browser.runtime.onMessage.addListener((message: unknown) => {
    const req = message as PageRequest | null;
    if (!req || typeof req !== 'object' || !('beifahrer' in req)) return undefined;
    // The DOM calls in here throw on hostile or unusual pages (a detached range, a
    // `DataTransfer` the page's CSP forbids). An exception escaping a message listener does not
    // reach the sender — it would see "no answer" and lose the reason — so it is answered.
    try {
      const res = handle(req);
      // Before a screenshot: answer only once a frame without the pill is on screen.
      if (req.beifahrer === 'hide') return afterRepaint().then(() => res);
      return Promise.resolve(res);
    } catch (err) {
      return Promise.resolve({ ok: false, code: 'failed', message: String((err as Error)?.message ?? err) });
    }
  });
}
