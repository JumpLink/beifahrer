/**
 * The page agent: injected on demand into a tab the policy allows, in the extension's isolated
 * world. It sees the page's DOM but not the page's JavaScript, and the page cannot see it.
 *
 * It does exactly five things — read, outline, describe, fill, click — and answers messages
 * from the background. The policy was already checked there; this script trusts its caller and
 * nothing else.
 *
 * Refs (`e1`, `e2`, …) are handed out by `outline` and stay valid for the life of the document:
 * an element keeps its ref across outlines, so an agent can outline, think, and act later.
 */

import { browser } from 'wxt/browser';
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

function labelFor(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
  if (tag === 'TEXTAREA' || role === 'textbox') return { role: 'textbox' };
  if (tag === 'SELECT' || role === 'combobox') return { role: 'combobox' };
  if (role === 'checkbox') return { role: 'checkbox' };
  if (role === 'tab') return { role: 'tab' };
  if (role === 'menuitem') return { role: 'menuitem' };
  if (role === 'link') return { role: 'link' };
  const html = el as HTMLElement;
  // The editing HOST only — every descendant of a contenteditable is editable too, and listing
  // each paragraph of a comment box as its own textbox would bury the one thing that matters.
  if (html.isContentEditable && !html.parentElement?.isContentEditable) return { role: 'richtext' };
  return null;
}

function state(): AgentState {
  globalThis.__beifahrer ??= { refs: new Map(), ids: new WeakMap(), next: 1 };
  return globalThis.__beifahrer;
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

function outline(maxItems: number): PageResponse {
  const lines: string[] = [];
  let truncated = false;
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) =>
        SKIP.has((node as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as Element;
    const kind = kindOf(el);
    if (!kind || !visible(el)) continue;
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

function read(maxChars: number): PageResponse {
  const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
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

function handle(req: PageRequest): PageResponse {
  switch (req.beifahrer) {
    case 'read':
      return read(req.maxChars);
    case 'outline':
      return outline(req.maxItems);
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
  }
}

export default defineUnlistedScript(() => {
  // Injected before every request; the listener must be installed once per document.
  if ((globalThis as { __beifahrerListening?: boolean }).__beifahrerListening) return;
  (globalThis as { __beifahrerListening?: boolean }).__beifahrerListening = true;
  browser.runtime.onMessage.addListener((message: unknown) => {
    const req = message as PageRequest | null;
    if (!req || typeof req !== 'object' || !('beifahrer' in req)) return undefined;
    // The DOM calls in here throw on hostile or unusual pages (a detached range, a
    // `DataTransfer` the page's CSP forbids). An exception escaping a message listener does not
    // reach the sender — it would see "no answer" and lose the reason — so it is answered.
    try {
      return Promise.resolve(handle(req));
    } catch (err) {
      return Promise.resolve({ ok: false, code: 'failed', message: String((err as Error)?.message ?? err) });
    }
  });
});
