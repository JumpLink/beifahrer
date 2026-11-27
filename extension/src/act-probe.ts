/**
 * What changed in this document, as a number — the page agent's half of "is the page quiet".
 *
 * A `MutationObserver` on the document (and on every same-origin iframe in it) counts REAL
 * mutations. Real is the point: pages rewrite attributes with the value they already have, animate
 * `style` every frame and tick clocks, and none of that is the page answering. Counting it would
 * make no page ever quiet, or — worse for the change verdict — make every action look like it
 * changed something.
 *
 * - An attribute write whose value equals the old one is dropped (`oldValue` is why the observer
 *   asks for it). Same for character data.
 * - A `style` change counts once per element per 200 ms: a transition is one change, not sixty.
 * - Nodes the agent itself put into the page (the pill) are not the page's doing: `ignore`.
 *
 * Idea from browser-use (`browser_use/ax.py`, MIT). Pure but for the observer, the clock and the
 * document it is handed, so the unit tests give it fakes.
 */

import { SETTLE_STYLE_THROTTLE_MS, type PageQuiet } from '@beifahrer/core';

/** The slice of a document the probe reads. A real `Document` satisfies it. */
export interface ProbeDocument {
  readyState: string;
  querySelectorAll(selector: string): ArrayLike<ProbeNode>;
}

/** An element as far as the probe looks: an iframe's document, an open shadow root. */
export interface ProbeNode {
  contentDocument?: ProbeDocument | null;
  shadowRoot?: ProbeDocument | null;
}

export interface ProbeDeps {
  doc: ProbeDocument;
  Observer: new (callback: (records: MutationRecord[]) => void) => MutationObserver;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** A random id for this document. */
  id: string;
  url(): string;
  /** A node the agent put there itself. */
  ignore?(node: Node): boolean;
}

const OBSERVED: MutationObserverInit = {
  attributes: true,
  attributeOldValue: true,
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  subtree: true,
};

export class MutationProbe {
  /** Real mutations so far. */
  n = 0;
  private lastAt: number;
  private readonly observer: MutationObserver;
  private readonly watched = new WeakSet<object>();
  private readonly styleAt = new WeakMap<object, number>();

  constructor(private readonly deps: ProbeDeps) {
    // The quiet window starts when we start looking: before that we cannot know what happened.
    this.lastAt = deps.now();
    this.observer = new deps.Observer((records) => this.take(records));
    this.watch(deps.doc);
  }

  get id(): string {
    return this.deps.id;
  }

  /**
   * Observe a document once, and what hides mutations from it: same-origin frames and OPEN shadow
   * roots (a component's own state lives there, and an observer on the document never sees it —
   * without this a click that changed only a component would read as "did nothing").
   */
  private watch(doc: ProbeDocument): void {
    if (!this.watched.has(doc)) {
      this.watched.add(doc);
      this.observer.observe(doc as unknown as Node, OBSERVED);
    }
    let nodes: ArrayLike<ProbeNode>;
    try {
      nodes = doc.querySelectorAll('*');
    } catch {
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      let inner: ProbeDocument | null | undefined;
      try {
        // A cross-origin frame throws or answers null: its own agent counts its own document.
        inner = nodes[i]?.contentDocument ?? nodes[i]?.shadowRoot;
      } catch {
        inner = null;
      }
      if (inner && !this.watched.has(inner)) this.watch(inner);
    }
  }

  private take(records: MutationRecord[]): void {
    const now = this.deps.now();
    for (const r of records) {
      if (this.ignored(r)) continue;
      if (r.type === 'attributes') {
        const el = r.target as Element;
        const name = r.attributeName;
        // An attribute written with the value it had is not a change.
        if (name !== null && el.getAttribute?.(name) === r.oldValue) continue;
        if (name === 'style') {
          const before = this.styleAt.get(el);
          if (before !== undefined && now - before < SETTLE_STYLE_THROTTLE_MS) continue;
          this.styleAt.set(el, now);
        }
      } else if (r.type === 'characterData') {
        if ((r.target as CharacterData).data === r.oldValue) continue;
      }
      this.n++;
      this.lastAt = now;
    }
  }

  private ignored(r: MutationRecord): boolean {
    const ignore = this.deps.ignore;
    if (!ignore) return false;
    if (ignore(r.target)) return true;
    if (r.type !== 'childList') return false;
    const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
    return nodes.length > 0 && nodes.every((node) => ignore(node));
  }

  /** Take the records the observer has not delivered yet, so a count read now is a count of now. */
  flush(): void {
    this.take(this.observer.takeRecords());
    this.watch(this.deps.doc);
  }

  snapshot(): { doc: string; url: string; n: number } {
    this.flush();
    return { doc: this.deps.id, url: this.deps.url(), n: this.n };
  }

  /**
   * Wait until the document is ready and has been still for `quietMs`, or `maxMs` is gone.
   * Answers either way: the caller decides what "not quiet" means.
   */
  async quiet(quietMs: number, maxMs: number): Promise<PageQuiet> {
    const end = this.deps.now() + maxMs;
    for (;;) {
      this.flush();
      const ready = this.deps.doc.readyState !== 'loading';
      const idle = this.deps.now() - this.lastAt;
      const quiet = ready && idle >= quietMs;
      const left = end - this.deps.now();
      if (quiet || left <= 0) return { ...this.snapshot(), ready, quiet };
      // Sleep as long as the quiet window still has to run, not in fixed ticks: a page that is
      // already still answers after exactly the window.
      const wait = ready ? quietMs - idle : 25;
      await this.deps.sleep(Math.max(10, Math.min(wait, left)));
    }
  }
}
