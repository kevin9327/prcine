import { Canvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { drawFrame, makeCanvas, type Plan } from "./render.js";
import { diffRect, imageChunks, muxAnimation, type WebpFrame } from "./webp.js";

export interface WebpOptions { width: number; fps: number; maxBytes: number }

async function encodePass(p: Plan, width: number, fps: number, quality: number): Promise<Buffer> {
  const { canvas, ctx } = makeCanvas(p);
  const w = width - (width % 2);
  const h = Math.round((p.opts.height * w) / p.opts.width / 2) * 2;
  const wc = new Canvas(w, h);
  const wg = wc.getContext("2d");
  wg.imageSmoothingEnabled = true;
  wg.imageSmoothingQuality = "high";
  const n = Math.round(p.opts.duration * fps);
  const frameMs = 1000 / fps;
  const frames: WebpFrame[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < n; i++) {
    drawFrame(p, ctx, i / fps);
    wg.drawImage(canvas, 0, 0, w, h);
    const cur = Buffer.from(wc.data());
    const r = prev ? diffRect(prev, cur, w, h) : { x: 0, y: 0, w, h };
    if (!r) { frames[frames.length - 1].duration += frameMs; continue; }
    const sub = new Canvas(r.w, r.h);
    sub.getContext("2d").drawImage(wc, -r.x, -r.y);
    const { data, alpha } = imageChunks(await sub.encode("webp", quality));
    frames.push({ ...r, duration: frameMs, data, alpha });
    prev = cur;
  }
  return muxAnimation(w, h, frames);
}

/** Render an animated WebP straight from the scene graph, stepping quality and size down to fit the budget. */
export async function renderWebp(p: Plan, out: string, o: WebpOptions) {
  const widths = [o.width, Math.round(o.width * 0.8), Math.round(o.width * 0.64)];
  const qualities = [82, 70, 58];
  let last: Buffer | null = null;
  for (const w of widths) for (const q of qualities) {
    const buf = await encodePass(p, w, o.fps, q);
    last = buf;
    if (buf.length <= o.maxBytes) { writeFileSync(out, buf); return { bytes: buf.length, quality: q, width: w }; }
  }
  throw new Error(`could not fit the WebP under ${(o.maxBytes / 1048576).toFixed(1)} MB (smallest try ${(last!.length / 1048576).toFixed(1)} MB); try --webp-width or a shorter --duration`);
}
