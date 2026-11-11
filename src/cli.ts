#!/usr/bin/env node
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadChangeSet } from "./source.js";
import { drawFrame, makeCanvas, plan, totalFrames } from "./render.js";
import { findFfmpeg, mp4Sink } from "./encode.js";
import { renderWebp } from "./webp-render.js";

const HELP = `prcine: turn a pull request or git range into a code-walkthrough video

Usage
  npx prcine <pr-url | owner/repo#123 | git-range> [options]

Examples
  npx prcine https://github.com/vercel/next.js/pull/12345
  npx prcine main...HEAD --aspect 9:16
  npx prcine HEAD~3..HEAD -o demo --duration 15

Options
  -o, --out <path>        Output path without extension (default: prcine)
  -d, --duration <sec>    Video length, 10-60 (default: 22)
  -a, --aspect <ratio>    16:9 | 9:16 | 1:1 (default: 16:9)
      --size <px>         Short side in pixels (default: 1080)
      --fps <n>           Frames per second (default: 30)
      --title <text>      Override the title
      --hunks <n>         Max number of code highlights
      --no-webp           Skip the animated WebP
      --no-mp4            Skip the MP4 (WebP only, no ffmpeg needed)
      --webp-max <MB>     WebP size budget (default: 5.5)
      --webp-width <px>   WebP width (default: 1280, or 720 for 9:16)
      --no-avatar         Do not fetch the author avatar
      --no-brand          Hide the small "made with prcine" credit
      --still <t,t,...>   Also write PNG stills at these seconds
      --still-only        Write only the stills (quick previews)
  -C, --cwd <dir>         Repository for git ranges (default: .)
  -h, --help              Show this help
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o", default: "prcine" },
      duration: { type: "string", short: "d", default: "22" },
      aspect: { type: "string", short: "a", default: "16:9" },
      size: { type: "string", default: "1080" },
      fps: { type: "string", default: "30" },
      title: { type: "string" },
      hunks: { type: "string" },
      "no-webp": { type: "boolean", default: false },
      "no-mp4": { type: "boolean", default: false },
      "webp-max": { type: "string", default: "5.5" },
      "webp-width": { type: "string" },
      "no-avatar": { type: "boolean", default: false },
      "no-brand": { type: "boolean", default: false },
      still: { type: "string" },
      "still-only": { type: "boolean", default: false },
      cwd: { type: "string", short: "C" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length === 0) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }
  const input = positionals[0];
  const duration = Math.min(60, Math.max(10, Number(values.duration)));
  const short = Number(values.size);
  const [aw, ah] = String(values.aspect).split(":").map(Number);
  if (!aw || !ah) throw new Error(`bad --aspect ${values.aspect}`);
  let width: number, height: number;
  if (aw >= ah) { height = short; width = Math.round((short * aw) / ah); } else { width = short; height = Math.round((short * ah) / aw); }
  width -= width % 2; height -= height % 2;
  const fps = Number(values.fps);

  const t0 = Date.now();
  const log = (m: string) => process.stderr.write(`prcine ${m}\n`);
  log(`reading ${input}`);
  const cs = await loadChangeSet(input, values.cwd ? resolve(values.cwd) : undefined);
  if (values.title) cs.title = values.title;
  if (!cs.files.length) throw new Error("no changes found");
  const p = await plan(cs, { width, height, fps, duration, maxHunks: values.hunks ? Number(values.hunks) : undefined, avatar: !values["no-avatar"], brand: !values["no-brand"] });
  log(`${cs.files.length} files, +${cs.additions} −${cs.deletions}; ${p.opts.duration.toFixed(1)}s; ${p.hunks.length} highlight(s): ${p.hunks.map((h) => h.file.path).join(", ")}`);

  const out = resolve(String(values.out).replace(/\.(mp4|webp)$/i, ""));
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  const { canvas, ctx } = makeCanvas(p);
  if (values.still) {
    for (const s of String(values.still).split(",").map(Number)) {
      drawFrame(p, ctx, s);
      writeFileSync(`${out}-${s.toFixed(2)}s.png`, await canvas.encode("png"));
    }
    log(`stills written`);
    if (values["still-only"]) return;
  }
  if (!values["no-mp4"]) {
    const ffmpeg = findFfmpeg();
    const sink = mp4Sink(ffmpeg, `${out}.mp4`, width, height, fps);
    const N = totalFrames(p);
    for (let i = 0; i < N; i++) {
      drawFrame(p, ctx, i / fps);
      await sink.write(canvas.data());
      if (process.stderr.isTTY && i % 15 === 0) process.stderr.write(`\rprcine rendering ${Math.round((i / N) * 100)}%`);
    }
    await sink.close();
    if (process.stderr.isTTY) process.stderr.write("\r");
    log(`wrote ${out}.mp4`);
  }
  if (!values["no-webp"]) {
    const ww = values["webp-width"] ? Number(values["webp-width"]) : width >= height ? 1280 : 720;
    const r = await renderWebp(p, `${out}.webp`, { width: ww, fps: 15, maxBytes: Number(values["webp-max"]) * 1024 * 1024 });
    log(`wrote ${out}.webp (${(r.bytes / 1024 / 1024).toFixed(2)} MB, q${r.quality}, ${r.width}px)`);
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { process.stderr.write(`prcine error: ${e instanceof Error ? e.message : e}\n`); process.exit(1); });
