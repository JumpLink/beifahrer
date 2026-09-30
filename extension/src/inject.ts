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
  const res = (await send(tabId, addressed, { frameId: frame })) as PageResponse | undefined;
  return res ?? undefined;
}
