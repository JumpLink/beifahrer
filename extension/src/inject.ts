/**
 * Get the page agent into a tab and talk to it — one adapter over two APIs.
 *
 * MV3 (Chromium) has `scripting.executeScript`; MV2 (Firefox, Epiphany) has
 * `tabs.executeScript`. Both inject the same built file, `page-agent.js`, into the extension's
 * isolated world; the agent guards against a second injection itself, so injecting before every
 * request is cheap and always safe.
 *
 * FRAMES (issue #32). The agent is injected into every frame, and each frame is addressed on its
 * own. Two things make that cheap, and both were checked before building it:
 *
 * - There is no `content_scripts` entry in the manifest, so nothing is injected until a call asks
 *   for it. `allFrames` therefore costs one script per frame PER CALL, never a standing cost on
 *   every page the person visits.
 * - The agent registers its `onMessage` listener once per document and ignores a request meant for
 *   another frame, so a broadcast is harmless even where a targeted send is not supported.
 *
 * Why not one broadcast and "whichever frame answers": that is a race, and a race in a WRITE is
 * a write in the wrong document. Every request names its frame.
 */

import { browser } from '@wxt-dev/browser';
import { browserInfo } from './browser-info.ts';
import type { PageRequest, PageResponse } from './page-messages.ts';

const FILE = '/page-agent.js';

export async function inject(tabId: number, allFrames = false): Promise<void> {
  const scripting = (browser as unknown as { scripting?: typeof browser.scripting }).scripting;
  if (scripting?.executeScript) {
    await scripting.executeScript({
      target: { tabId, ...(allFrames ? { allFrames: true } : {}) },
      files: [FILE],
    });
    return;
  }
  const tabs = browser.tabs as unknown as {
    executeScript?: (tabId: number, details: { file: string; allFrames?: boolean }) => Promise<unknown>;
  };
  if (typeof tabs.executeScript !== 'function') throw new Error('this browser can inject no script');
  await tabs.executeScript(tabId, { file: FILE, ...(allFrames ? { allFrames: true } : {}) });
}

/**
 * Ask one frame. `frame` 0 is the page's own document; anything else is a frame's browser-assigned
 * number, which only the extension knows.
 *
 * A frame that does not answer is not an error here: it may be gone, or it may be a frame the
 * browser never injected into (a `data:` or `about:blank` one has no host access of its own). The
 * caller decides what a missing document means — for a read it is one section fewer, for a write it
 * is `not_found`.
 */
export async function askPage<T extends PageRequest>(
  tabId: number,
  req: T,
  frame = 0,
): Promise<PageResponse | undefined> {
  await inject(tabId, frame !== 0);
  const send = browser.tabs.sendMessage as unknown as (
    tabId: number,
    message: unknown,
    options?: { frameId?: number },
  ) => Promise<unknown>;
  // The request carries its own addressee (`frame`) and every frame drops what is not for it, so
  // correctness does not rest on the send API's addressing. Two measured reasons:
  //
  // - A `tabs.sendMessage` WITHOUT a frameId goes to EVERY frame and whichever answers first is the
  //   answer. A `page_read` of the fixture returned the FRAME's text under the FRAME's url, because a
  //   frame was quicker off the mark than the document the call was about — and a race that resolves
  //   wrongly in a write is a write in the wrong document.
  // - The `frameId` OPTION did not reach a frame in this browser at all, with a frame that was
  //   demonstrably there (it had just announced itself and answered `where`).
  //
  // `frameId` is passed anyway, because where it works it is the cheaper path, and a request that
  // reaches exactly one frame cannot be misrouted even if the filter were wrong.
  const addressed = { ...req, frame } as T;
  if (await asksByScript()) return askByScript(tabId, addressed, frame);
  const res = (await send(tabId, addressed, { frameId: frame })) as PageResponse | undefined;
  return res ?? undefined;
}

let byScript: boolean | undefined;

/**
 * Safari never delivers `tabs.sendMessage` to a script that `scripting.executeScript` injected: a
 * listener in the page saw 0 of 5 messages, every send came back `undefined`, while the agent was
 * demonstrably there (Safari 27.0.1, 2026-10-04). Asked by family, not by feature test, because the
 * failure is silence and silence is also what a frame that is not the addressee sends.
 */
async function asksByScript(): Promise<boolean> {
  byScript ??= (await browserInfo()).family === 'safari';
  return byScript;
}

/** The same question through `executeScript`, whose `func` result does come back, promises included. */
async function askByScript(
  tabId: number,
  req: PageRequest,
  frame: number,
): Promise<PageResponse | undefined> {
  const scripting = (browser as unknown as { scripting: typeof browser.scripting }).scripting;
  const results = await scripting.executeScript({
    target: { tabId, frameIds: [frame] },
    func: (request: unknown) =>
      (globalThis as { __beifahrerAsk?: (r: unknown) => unknown }).__beifahrerAsk?.(request),
    args: [req],
  });
  return (results[0]?.result as PageResponse | undefined) ?? undefined;
}

/**
 * Say something to the agent that is ALREADY in the tab, without injecting it: a tab it was never
 * injected into has no receiver, and that is an answer of "nobody", not an error.
 */
export async function tellPage(tabId: number, req: PageRequest): Promise<void> {
  if (await asksByScript()) {
    await askByScript(tabId, req, 0).catch(() => undefined);
    return;
  }
  await browser.tabs.sendMessage(tabId, req).catch(() => undefined);
}
