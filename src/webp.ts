/**
 * Minimal animated-WebP muxer. Each frame is a lossy WebP still of the changed
 * rectangle only, placed with "no blend" so it fully replaces what was there.
 * That keeps files small for mostly-static UI video and, unlike lossy inter-frame
 * blending, never leaves ghosts of earlier frames behind.
 */
export interface WebpFrame { x: number; y: number; w: number; h: number; duration: number; data: Buffer; alpha: boolean }

function chunk(id: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat(payload.length & 1 ? [head, payload, Buffer.alloc(1)] : [head, payload]);
}

function u24(buf: Buffer, off: number, v: number) { buf.writeUIntLE(v, off, 3); }

/** Pull the image chunks (ALPH + VP8/VP8L) out of a standalone WebP file. */
export function imageChunks(webp: Buffer): { data: Buffer; alpha: boolean } {
  if (webp.toString("latin1", 0, 4) !== "RIFF" || webp.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP");
  const keep: Buffer[] = [];
  let alpha = false;
  for (let o = 12; o + 8 <= webp.length;) {
    const id = webp.toString("latin1", o, o + 4);
    const size = webp.readUInt32LE(o + 4);
    if (id === "ALPH" || id === "VP8 " || id === "VP8L") {
      keep.push(webp.subarray(o, o + 8 + size + (size & 1)));
      if (id === "ALPH" || id === "VP8L") alpha = alpha || id === "ALPH";
    }
    o += 8 + size + (size & 1);
  }
  if (!keep.length) throw new Error("WebP has no image data");
  return { data: Buffer.concat(keep), alpha };
}

export function muxAnimation(width: number, height: number, frames: WebpFrame[], loop = 0, bg = 0xff000000): Buffer {
  const vp8x = Buffer.alloc(10);
  const anyAlpha = frames.some((f) => f.alpha);
  vp8x[0] = 0x02 | (anyAlpha ? 0x10 : 0); // animation (+ alpha)
  u24(vp8x, 4, width - 1); u24(vp8x, 7, height - 1);
  const anim = Buffer.alloc(6);
  anim.writeUInt32LE(bg >>> 0, 0); anim.writeUInt16LE(loop, 4);
  const parts: Buffer[] = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  for (const f of frames) {
    if (f.x & 1 || f.y & 1) throw new Error("frame offsets must be even");
    const h = Buffer.alloc(16);
    u24(h, 0, f.x / 2); u24(h, 3, f.y / 2); u24(h, 6, f.w - 1); u24(h, 9, f.h - 1);
    u24(h, 12, Math.max(1, Math.min(0xffffff, Math.round(f.duration))));
    h[15] = 0x02; // do not blend, do not dispose
    parts.push(chunk("ANMF", Buffer.concat([h, f.data])));
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(4 + body.length, 4); riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, body]);
}

/** Bounding box of pixels that differ between two RGBA buffers, or null if identical. */
export function diffRect(a: Uint8Array, b: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const a32 = new Uint32Array(a.buffer, a.byteOffset, w * h);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (a32[row + x] !== b32[row + x]) { x0 = x; break; }
    if (x0 < 0) continue;
    for (let x = w - 1; x >= x0; x--) if (a32[row + x] !== b32[row + x]) { x1 = x; break; }
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y < minY) minY = y;
    maxY = y;
  }
  if (maxX < 0) return null;
  // ANMF offsets are stored halved, so align the origin to even pixels
  const x = minX & ~1, y = minY & ~1;
  return { x, y, w: maxX - x + 1, h: maxY - y + 1 };
}
