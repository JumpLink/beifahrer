import { describe, expect, it } from '@gjsify/unit';

import { CHUNK_CHARS, ChunkAssembler, parseChunk, splitFrame } from '@beifahrer/core';

export default async () => {
  await describe('splitFrame', async () => {
    await it('leaves a small frame alone', async () => {
      expect(splitFrame(1, '{"a":1}')).toStrictEqual(['{"a":1}']);
    });

    await it("cuts a large frame below libsoup's 128 KiB, even for the widest character", async () => {
      // U+4E2D is 1 code unit and 3 UTF-8 bytes — the widest character PER CODE UNIT, which is what
      // `slice` counts. An emoji is wider (4 bytes) but spans 2 units, so it costs 2 bytes each and
      // never comes close; measuring the emoji alone would watch the slack case.
      const json = JSON.stringify({ text: '\u4e2d'.repeat(CHUNK_CHARS * 3) });
      const frames = splitFrame(7, json);
      expect(frames.length > 3).toBe(true);
      for (const f of frames) expect(new TextEncoder().encode(f).length < 128 * 1024).toBe(true);
    });

    await it('round-trips a character the cut fell in half of', async () => {
      // `slice` can split a surrogate pair; the pieces must still join back into the emoji.
      const text = 'a🙂b🙂c'.repeat(CHUNK_CHARS);
      const json = JSON.stringify({ type: 'response', id: 9, ok: true, result: { text } });
      const asm = new ChunkAssembler();
      let whole: string | null = null;
      for (const raw of splitFrame(9, json)) {
        const chunk = parseChunk(JSON.parse(raw));
        whole = asm.add(chunk!);
      }
      expect((JSON.parse(whole!) as { result: { text: string } }).result.text).toBe(text);
    });

    await it('puts the pieces back together, also when they arrive for two ids at once', async () => {
      const a = JSON.stringify({ type: 'response', id: 1, ok: true, result: 'a'.repeat(100_000) });
      const b = JSON.stringify({ type: 'response', id: 2, ok: true, result: 'b'.repeat(70_000) });
      const fa = splitFrame(1, a);
      const fb = splitFrame(2, b);
      const asm = new ChunkAssembler();
      const done: Record<number, string> = {};
      const feed = (raw: string) => {
        const chunk = parseChunk(JSON.parse(raw));
        const whole = chunk && asm.add(chunk);
        if (whole && chunk) done[chunk.id] = whole;
      };
      for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
        if (fa[i]) feed(fa[i]!);
        if (fb[i]) feed(fb[i]!);
      }
      expect(done[1]).toBe(a);
      expect(done[2]).toBe(b);
    });

    await it('drops an answer with a gap instead of guessing', async () => {
      const frames = splitFrame(3, 'x'.repeat(CHUNK_CHARS * 3));
      const asm = new ChunkAssembler();
      expect(asm.add(parseChunk(JSON.parse(frames[0]!))!)).toBe(null);
      expect(asm.add(parseChunk(JSON.parse(frames[2]!))!)).toBe(null);
    });

    await it('rejects malformed chunk frames', async () => {
      expect(parseChunk({ type: 'chunk', id: 1, seq: 2, count: 2, data: '' })).toBe(null);
      expect(parseChunk({ type: 'chunk', id: 1, seq: 0, count: 1, data: 5 })).toBe(null);
      expect(parseChunk({ type: 'response' })).toBe(null);
    });
  });
};
