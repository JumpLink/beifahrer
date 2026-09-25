/**
 * The pill a page shows while the agent reads or edits it: "beifahrer is reading", with a Stop
 * button. Part of the page agent, so it exists only in a tab the policy already let us into.
 *
 * - CLOSED shadow root: the page sees one empty host element and cannot read the pill's text or
 *   reach the Stop button. `page.read` reads `body.innerText`, which the host (a child of
 *   `<html>`, outside `<body>`) and its shadow tree are not part of.
 * - `position: fixed` on the host, top z-index: no layout change on the page.
 * - `pointer-events: none` everywhere except the Stop button, so the pill never swallows a click
 *   meant for the page below it.
 * - Removed ~3 s after the last action, and at once before a screenshot (`hideNow`).
 */

import { browser } from '@wxt-dev/browser';
import { STOP_MESSAGE } from './page-messages.ts';

export const HOST_TAG = 'beifahrer-indicator';
const HIDE_AFTER_MS = 3_000;

let host: HTMLElement | null = null;
let label: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const CSS = `
:host { all: initial; }
.pill {
  position: fixed; top: 12px; right: 12px; z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  padding: 6px 6px 6px 12px; border-radius: 999px;
  background: #1d1d1f; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.3);
  font: 600 13px/1.2 system-ui, sans-serif; pointer-events: none;
}
.label { max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #e66100; }
button {
  pointer-events: auto; cursor: pointer; font: inherit; color: #fff;
  background: #c01c28; border: 0; border-radius: 999px; padding: 4px 10px;
}
`;

function build(): HTMLElement {
  const el = document.createElement(HOST_TAG);
  el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = el.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'dot';
  label = document.createElement('span');
  label.className = 'label';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = 'Stop';
  stop.title = 'Pause beifahrer: the agent gets nothing from this browser until you resume it in the toolbar';
  stop.addEventListener('click', (event) => {
    // A click the page synthesised cannot reach a closed shadow root, and would only pause anyway.
    if (!event.isTrusted) return;
    void browser.runtime.sendMessage({ type: STOP_MESSAGE });
    if (label) label.textContent = 'beifahrer paused';
    stop.remove();
    schedule();
  });
  pill.append(dot, label, stop);
  root.append(style, pill);
  return el;
}

function schedule(): void {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideNow, HIDE_AFTER_MS);
}

/** `session` is the agent session's label; the text lives in the closed shadow root, out of the page's reach. */
export function show(verb: 'reading' | 'editing', session?: string): void {
  if (!host || !host.isConnected) {
    host = build();
    document.documentElement.append(host);
  }
  if (label) label.textContent = session ? `beifahrer (${session}) is ${verb}` : `beifahrer is ${verb}`;
  schedule();
}

export function hideNow(): void {
  clearTimeout(hideTimer);
  host?.remove();
  host = null;
  label = null;
}

/**
 * Resolves once the browser has painted a frame without the pill (for screenshots). The timeout
 * covers a tab that paints no frames at all; the screenshot then shows what it shows.
 */
export function afterRepaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}
