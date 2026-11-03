/**
 * The popup's connection diagram (ADR 0025): the shared artwork in data/diagram/, spliced inline so
 * the classes on its root can switch the states, and every word drawn here, beside it, out of the
 * extension's own catalogue. The artwork has no text and no colour variables (librsvg cannot read
 * either), so state is classes on `#diagram` and dark is one of them.
 *
 * One arrangement is in the page at a time: both files carry the same ids and gradients, and a
 * gradient inside a `display: none` subtree does not paint. The label layout follows a container
 * query in style.css; the artwork follows the same 420 px, measured here.
 */

import { browser } from '@wxt-dev/browser';
import { type McpClient, type SiblingBrowser } from '@beifahrer/core';
import { t } from '../i18n.ts';
import type { LinkState } from './status.ts';

export const WIDE_AT = 420;
/** Beyond this many names the host writes "+ n more"; the artwork never grows. */
const NAMED = 3;

export type Fix = 'pair' | 'resume' | null;

export interface DiagramModel {
  l1: LinkState;
  l2: LinkState;
  /** The MCP clients of the connected sessions, one per session. */
  apps: McpClient[];
  /** This browser first, then the siblings the bridge named. */
  browsers: SiblingBrowser[];
  sessions: number;
  paused: boolean;
  /** The one sentence under the diagram, and the button that goes with it. */
  fix: { sentence: 'unpaired' | 'unauthorized' | 'protocol' | 'waiting' | 'paused'; action: Fix } | null;
}

const LINK_WORDS = {
  ok: 'diagram_link_ok',
  wait: 'diagram_link_wait',
  fail: 'diagram_link_fail',
  unknown: 'diagram_link_unknown',
} as const;

const FIX_WORDS = {
  unpaired: 'diagram_fix_unpaired',
  unauthorized: 'diagram_fix_unauthorized',
  protocol: 'diagram_fix_protocol',
  waiting: 'diagram_fix_waiting',
  paused: 'diagram_fix_paused',
} as const;

const svgText = new Map<string, Promise<string>>();
function artwork(name: string): Promise<string> {
  let text = svgText.get(name);
  if (!text) {
    text = fetch(browser.runtime.getURL(`/diagram/${name}.svg` as '/'))
      .then((r) => r.text())
      .catch(() => '');
    svgText.set(name, text);
  }
  return text;
}

const names = (list: string[]): string => {
  const shown = list.slice(0, NAMED).join(', ');
  return list.length > NAMED ? `${shown} ${t('diagram_more', list.length - NAMED)}` : shown;
};

/** The count class the artwork knows: 1 draws no stack, 2 and 3 draw one and two cards. */
const stack = (prefix: string, n: number): string[] => (n >= 2 ? [`${prefix}-${Math.min(n, 3)}`] : []);

export class Diagram {
  readonly #host: HTMLElement;
  #arrangement = '';
  #model: DiagramModel | null = null;
  #dark = matchMedia('(prefers-color-scheme: dark)');

  constructor(host: HTMLElement, onAction: (action: Fix) => void) {
    this.#host = host;
    host.innerHTML = `
      <div class="diagram-body">
        <div class="diagram-art" data-part="art" aria-hidden="true"></div>
        <div class="diagram-words">
          <div class="dg-label dg-app" data-part="app"></div>
          <div class="dg-link dg-link1" data-part="link1"></div>
          <div class="dg-label dg-beifahrer" data-part="beifahrer"></div>
          <div class="dg-link dg-link2" data-part="link2"></div>
          <div class="dg-label dg-browser"><span data-part="browser"></span><span class="here-pill" data-part="here"></span></div>
        </div>
      </div>
      <div class="diagram-fix" data-part="fix" hidden>
        <p data-part="sentence"></p>
        <gtk-button data-part="action" pill></gtk-button>
      </div>`;
    this.#part('action').addEventListener('click', () => onAction(this.#model?.fix?.action ?? null));
    new ResizeObserver(() => void this.#render()).observe(host);
    this.#dark.addEventListener('change', () => void this.#render());
  }

  #part(name: string): HTMLElement {
    return this.#host.querySelector(`[data-part="${name}"]`) as HTMLElement;
  }

  set(model: DiagramModel): void {
    this.#model = model;
    void this.#render();
  }

  async #render(): Promise<void> {
    const m = this.#model;
    if (!m) return;
    const wide = this.#host.clientWidth >= WIDE_AT;
    const art = this.#part('art');
    if (this.#arrangement !== (wide ? 'h' : 'v') || !art.firstElementChild) {
      this.#arrangement = wide ? 'h' : 'v';
      const text = await artwork(wide ? 'connection' : 'connection-vertical');
      if (this.#arrangement !== (wide ? 'h' : 'v')) return;
      // The artwork's header comment quotes `var(--x)`, a double hyphen XML forbids in a comment:
      // the comment goes before parsing, the shared file stays as it is.
      const doc = new DOMParser().parseFromString(
        text.replace(/<!--[\s\S]*?-->/g, ''),
        'image/svg+xml',
      ).documentElement;
      art.replaceChildren(doc.localName === 'svg' ? document.importNode(doc, true) : '');
    }
    const svg = art.firstElementChild;
    if (svg) {
      const gone = m.browsers.some((b) => !b.connected);
      const classes = [
        `l1-${m.l1}`,
        `l2-${m.l2}`,
        'here-extension',
        ...stack('stacked', m.sessions),
        ...stack('browsers', m.browsers.length),
        ...(gone ? ['browser-gone'] : []),
        ...(m.paused ? ['paused'] : []),
        ...(this.#dark.matches ? ['dark'] : []),
      ];
      svg.setAttribute('class', classes.join(' '));
    }

    this.#part('app').textContent = m.apps.length ? names(m.apps.map((a) => a.name)) : t('diagram_node_app');
    this.#part('beifahrer').textContent = t('diagram_node_beifahrer');
    this.#part('browser').textContent = names(m.browsers.map((b) => b.name)) || t('diagram_node_browser');
    this.#part('here').textContent = t('diagram_here_extension');
    this.#part('link1').textContent = t(LINK_WORDS[m.l1]);
    this.#part('link2').textContent = t(LINK_WORDS[m.l2]);
    this.#host.dataset.l1 = m.l1;
    this.#host.dataset.l2 = m.l2;

    const fix = this.#part('fix');
    fix.hidden = !m.fix;
    if (m.fix) {
      this.#part('sentence').textContent = t(FIX_WORDS[m.fix.sentence]);
      const action = this.#part('action');
      action.hidden = !m.fix.action;
      if (m.fix.action)
        action.setAttribute('label', t(m.fix.action === 'resume' ? 'action_resume' : 'action_pair'));
    }
  }
}
