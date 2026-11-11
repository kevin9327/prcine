import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

export function findFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return "ffmpeg"; } catch { /* fall through */ }
  try {
    const req = createRequire(import.meta.url);
    const p = req("ffmpeg-static") as string | null;
    if (p) return p;
  } catch { /* optional */ }
  throw new Error("ffmpeg not found. Install ffmpeg (brew install ffmpeg / apt install ffmpeg) or set FFMPEG_PATH.");
}

export interface FrameSink { write(buf: Buffer): Promise<void>; close(): Promise<void> }

export function mp4Sink(ffmpeg: string, out: string, w: number, h: number, fps: number, crf = 18): FrameSink {
  const ff = spawn(ffmpeg, [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return {
    write: (buf) => new Promise((res, rej) => { ff.stdin.write(buf, (e) => (e ? rej(e) : res())); }),
    close: async () => { ff.stdin.end(); await done; },
  };
}
