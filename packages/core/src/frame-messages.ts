/**
 * What a frame says about itself when it is injected (issue #32).
 *
 * The only message a content script may send UNPROMPTED — the Stop button already sends one, and it
 * can only pause. This one carries no request and asks for nothing: a frame states where it is so
 * the extension can decide whether the person's policy for that origin lets the agent read it. A
 * frame that says nothing is simply never asked, so the message is not load-bearing — it is how the
 * extension LEARNS the frame exists without a permission of its own.
 */

/** Sent by a frame's page agent right after it is injected. */
export const FRAME_HELLO = 'beifahrer-frame-hello';

export interface FrameHello {
  type: typeof FRAME_HELLO;
  /** `location.href` of the frame that is speaking, which only that frame can read. */
  url: string;
}

export function isFrameHello(message: unknown): message is FrameHello {
  const m = message as { type?: unknown; url?: unknown } | null;
  return (
    !!m && m.type === FRAME_HELLO && typeof m.url === 'string' && m.url.length > 0 && m.url.length <= 4_000
  );
}
