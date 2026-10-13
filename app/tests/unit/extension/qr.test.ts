import { describe, expect, it } from '@gjsify/unit';
import qrcode from 'qrcode-generator';

import { decodeQr, type QrCandidate } from '../../../../extension/src/qr.ts';

/** A synthetic QR code, drawn dark on light with a quiet zone, as the page agent would hand it over. */
function candidateOf(text: string, opts: { scale?: number; invert?: boolean } = {}): QrCandidate {
  const scale = opts.scale ?? 6;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const side = (modules + 8) * scale;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.floor(y / scale) - 4;
      const c = Math.floor(x / scale) - 4;
      const dark = r >= 0 && c >= 0 && r < modules && c < modules && qr.isDark(r, c);
      const v = dark !== (opts.invert === true) ? 0 : 255;
      const i = (y * side + x) * 4;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = v;
      bytes[i + 3] = 255;
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { width: side, height: side, rgba: btoa(binary) };
}

const blank: QrCandidate = {
  width: 2,
  height: 2,
  rgba: btoa(String.fromCharCode(...Array.from({ length: 16 }, () => 255))),
};

export default async () => {
  await describe('decodeQr', async () => {
    await it('reads a QR code', async () => {
      expect(decodeQr([candidateOf('https://login.example/qr?c=abc123')])).toBe(
        'https://login.example/qr?c=abc123',
      );
    });

    await it('reads light-on-dark as well', async () => {
      expect(decodeQr([candidateOf('inverted', { invert: true })])).toBe('inverted');
    });

    await it('takes the first candidate that holds a code', async () => {
      expect(decodeQr([blank, candidateOf('second')])).toBe('second');
    });

    await it('is null when nothing holds one, and for a candidate of the wrong size', async () => {
      expect(decodeQr([blank])).toBe(null);
      expect(decodeQr([{ ...blank, width: 9 }])).toBe(null);
      expect(decodeQr([])).toBe(null);
    });
  });
};
