/**
 * Large frames, sent in pieces.
 *
 * libsoup (what the GJS bridge listens with) closes a WebSocket with 1009 once ONE message passes
 * 128 KiB, and no property raises that cap (`max-incoming-payload-size` does not; measured on
 * libsoup 3.6.6). A PNG screenshot is megabytes, so `page_screenshot` killed the whole connection
 * and the call read "went away" (issue: Firefox 155, active tab). A response past `CHUNK_CHARS`
 * therefore travels as `chunk` frames, each well under the cap, and is put back together on the
 * other side. The pieces are cut by characters, not bytes, so the bound has to hold for the widest
 * character there is and not for an average one. "Character" here is what `slice` counts, a UTF-16
 * code unit, and the widest character PER CODE UNIT is 3 UTF-8 bytes (U+0800–U+FFFF: `€`, CJK), so
 * 32 000 of them are at most 96 000 bytes and the envelope adds some 60. A code point outside the
 * BMP (an emoji) is the widest character but not the widest unit: it is 4 bytes over TWO units, so
 * it costs 2 bytes each and is never the case that breaks. Cutting between the halves of such a
 * character is harmless — `JSON.stringify` escapes a lone surrogate and the pieces join back into
 * the pair — and `splitFrame`'s tests prove both the byte bound and that round trip.
 */

/**
 * Characters per chunk. Three bytes per code unit plus the envelope stay under libsoup's 128 KiB
 * per message. Lowering this is free; above ~43 600 screenshots break again, and the bound is not
 * this file's to negotiate — it comes from libsoup.
 */
export const CHUNK_CHARS = 32_000;
/** An answer past this is refused rather than buffered: the bridge's memory is not the browser's. */
export const MAX_CHUNKED_CHARS = 96 * 1024 * 1024;

export interface ChunkFrame {
  type: 'chunk';
  /** The request id the whole answer belongs to. */
  id: number;
  seq: number;
  count: number;
  data: string;
}

/** The frames to send for a serialized frame: itself when small, `chunk` frames otherwise. */
export function splitFrame(id: number, json: string): string[] {
  if (json.length <= CHUNK_CHARS) return [json];
  const count = Math.ceil(json.length / CHUNK_CHARS);
  const frames: string[] = [];
  for (let seq = 0; seq < count; seq++) {
    const data = json.slice(seq * CHUNK_CHARS, (seq + 1) * CHUNK_CHARS);
    frames.push(JSON.stringify({ type: 'chunk', id, seq, count, data } satisfies ChunkFrame));
  }
  return frames;
}

export function parseChunk(raw: unknown): ChunkFrame | null {
  const c = raw as Partial<ChunkFrame> | null;
  if (!c || c.type !== 'chunk') return null;
  if (!Number.isInteger(c.id) || !Number.isInteger(c.seq) || !Number.isInteger(c.count)) return null;
  if (typeof c.data !== 'string' || c.seq! < 0 || c.count! < 1 || c.seq! >= c.count!) return null;
  return c as ChunkFrame;
}

/** Collects chunks per request id; `add` returns the whole serialized frame once complete. */
export class ChunkAssembler {
  readonly #parts = new Map<number, { count: number; next: number; pieces: string[]; chars: number }>();

  add(chunk: ChunkFrame): string | null {
    let entry = this.#parts.get(chunk.id);
    if (!entry || entry.count !== chunk.count) {
      entry = { count: chunk.count, next: 0, pieces: [], chars: 0 };
      this.#parts.set(chunk.id, entry);
    }
    // TCP and WebSocket keep order; a gap means a broken sender, and dropping it beats guessing.
    if (chunk.seq !== entry.next) {
      this.#parts.delete(chunk.id);
      return null;
    }
    entry.pieces.push(chunk.data);
    entry.chars += chunk.data.length;
    entry.next++;
    if (entry.chars > MAX_CHUNKED_CHARS) {
      this.#parts.delete(chunk.id);
      return null;
    }
    if (entry.next < entry.count) return null;
    this.#parts.delete(chunk.id);
    return entry.pieces.join('');
  }

  clear(): void {
    this.#parts.clear();
  }
}
