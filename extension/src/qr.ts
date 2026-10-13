/**
 * Decode the QR code a login page shows (ADR 0022). The page agent hands over pixels; the decoder
 * (jsQR, Apache-2.0, pure JS) lives here, in the background, so that script — injected into every
 * tab the agent touches — does not carry it.
 *
 * What comes out is a session challenge. It is returned to the one caller (the recipe runner, which
 * passes it to the person) and never written anywhere from here: not to the log, not into an error.
 */

import jsQRImport from 'jsqr';

type Decoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'attemptBoth' },
) => { data: string } | null;
// jsQR is a CommonJS bundle whose function is `exports.default`; whether the import hands over the
// function or that object depends on the bundler, so take either.
const jsQR: Decoder =
  (jsQRImport as unknown as { default?: Decoder }).default ?? (jsQRImport as unknown as Decoder);

/** One image-like element, rendered to RGBA by the page agent. */
export interface QrCandidate {
  width: number;
  height: number;
  /** `width * height * 4` bytes, base64. */
  rgba: string;
}

/** The content of the first candidate that holds a QR code, or null. */
export function decodeQr(candidates: readonly QrCandidate[]): string | null {
  for (const c of candidates) {
    const binary = atob(c.rgba);
    if (binary.length !== c.width * c.height * 4) continue;
    const pixels = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) pixels[i] = binary.charCodeAt(i);
    const found = jsQR(pixels, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (found?.data) return found.data;
  }
  return null;
}
