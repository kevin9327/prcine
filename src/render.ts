import { Canvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { langFor, tokenize, type Tok } from "./highlight.js";
import { fileWeight, pickHighlights } from "./pick.js";
import { C, LANG_COLOR, MONO, SANS, clamp01, ease, fmt, hexA, lerp, prog } from "./style.js";
import type { ChangeSet, FileDiff, LineKind } from "./types.js";

type Ctx = SKRSContext2D;

const here = dirname(fileURLToPath(import.meta.url));
let fontsReady = false;
export function registerFonts() {
  if (fontsReady) return;
  const dir = join(here, "..", "assets", "fonts");
  for (const f of readdirSync(dir)) if (f.endsWith(".ttf")) GlobalFonts.registerFromPath(join(dir, f));
  fontsReady = true;
}

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  maxHunks?: number;
  avatar?: boolean;
  brand?: boolean;
}

interface PLine { kind: LineKind; no?: number; text: string; toks: Tok[] }
interface PHunk { file: FileDiff; lang: string; header: string; lines: PLine[]; adds: number; dels: number; chars: number }

interface Scene { kind: "title" | "files" | "code" | "outro"; start: number; dur: number; hunk?: number }

export interface Plan {
  cs: ChangeSet;
  opts: RenderOptions;
  hunks: PHunk[];
  scenes: Scene[];
  avatar?: Image;
  portrait: boolean;
  S: number;
  bgLayer: Canvas;
}

const XFADE = 0.45;

function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) { if (!l.trim()) continue; const m = /^[ ]*/.exec(l)![0].length; if (m < min) min = m; }
  if (!isFinite(min) || min === 0) return lines;
  return lines.map((l) => l.slice(Math.min(min, /^[ ]*/.exec(l)![0].length)));
}

export async function plan(cs: ChangeSet, opts: RenderOptions): Promise<Plan> {
  opts = { ...opts };
  registerFonts();
  const portrait = opts.height >= opts.width; // square uses the stacked (vertical) layout
  const S = Math.min(opts.width, opts.height) / 1080;
  const maxLines = opts.height > opts.width * 1.3 ? 20 : 13;
  const D = opts.duration;
  // how many hunks fit: title 3.1 + files 3.0 + outro 3.2, ~4.2s per hunk
  const fixed = 3.1 + 3.0 + 3.2;
  let k = Math.max(1, Math.floor((D - fixed + XFADE * 3) / 4.2));
  if (opts.maxHunks) k = Math.min(k, opts.maxHunks);
  const hs = pickHighlights(cs, k, maxLines);
  const hunks: PHunk[] = [];
  for (const h of hs) {
    const lang = langFor(h.file.path);
    const texts = dedent(h.lines.map((l) => l.text.replace(/\t/g, "    ")));
    const toks = await tokenize(texts.join("\n"), lang, C.sub);
    const lines = h.lines.map((l, i) => ({ kind: l.kind, no: l.kind === "del" ? l.oldNo : l.newNo, text: texts[i], toks: toks[i] ?? [{ text: texts[i], color: C.sub }] }));
    hunks.push({
      file: h.file, lang, header: h.header.trim(), lines,
      adds: lines.filter((l) => l.kind === "add").length,
      dels: lines.filter((l) => l.kind === "del").length,
      chars: lines.filter((l) => l.kind === "add").reduce((a, l) => a + l.text.length, 0),
    });
  }
  // timeline
  const n = hunks.length;
  const transitions = n + 2; // between n+3 scenes
  let codeDur = n ? (D - fixed + transitions * XFADE) / n : 0;
  let tTitle = 3.1, tFiles = 3.0, tOutro = 3.2;
  if (n && codeDur < 3.4) { // compress fixed scenes for very short videos
    const need = (3.4 - codeDur) * n;
    const f = Math.max(0.55, 1 - need / fixed);
    tTitle *= f; tFiles *= f; tOutro *= f;
    codeDur = (D - (tTitle + tFiles + tOutro) + transitions * XFADE) / n;
  }
  codeDur = Math.min(codeDur, 6.5);
  const scenes: Scene[] = [];
  let t = 0;
  const push = (s: Omit<Scene, "start">) => { scenes.push({ ...s, start: t }); t += s.dur - XFADE; };
  push({ kind: "title", dur: tTitle });
  push({ kind: "files", dur: tFiles });
  // a hunk only gets as long as its change needs: tiny edits don't sit on screen for 6 seconds
  hunks.forEach((h, i) => {
    const changedLines = h.adds + h.dels;
    const ideal = Math.max(3.4, Math.min(6.5, 2.6 + 0.2 * changedLines + h.chars / 90));
    push({ kind: "code", dur: Math.min(codeDur, ideal), hunk: i });
  });
  // the outro absorbs rounding; when there is little worth showing, the video gets shorter instead of padding
  const outroDur = Math.max(2, Math.min(4.4, D - t));
  scenes.push({ kind: "outro", start: t, dur: outroDur });
  opts = { ...opts, duration: Math.min(D, t + outroDur) };

  let avatar: Image | undefined;
  if (opts.avatar !== false && cs.author && cs.state !== "range") {
    try {
      const res = await fetch(`https://github.com/${cs.author}.png?size=160`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) avatar = await loadImage(Buffer.from(await res.arrayBuffer()));
    } catch { /* offline is fine */ }
  }
  return { cs, opts, hunks, scenes, avatar, portrait, S, bgLayer: makeBg(opts.width, opts.height, S) };
}

export function totalFrames(p: Plan) { return Math.round(p.opts.duration * p.opts.fps); }

function makeBg(W: number, H: number, S: number): Canvas {
  const c = new Canvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  // dot grid
  const step = Math.round(36 * S);
  g.fillStyle = "rgba(255,255,255,0.035)";
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) { g.beginPath(); g.arc(x, y, 1.1 * S, 0, Math.PI * 2); g.fill(); }
  // vignette
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(7,8,11,0)"); v.addColorStop(1, "rgba(7,8,11,0.92)");
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return c;
}

function drawBg(p: Plan, g: Ctx, t: number) {
  const { width: W, height: H } = p.opts;
  g.drawImage(p.bgLayer, 0, 0);
  // two slow glows
  // static glows: a still background keeps the animated WebP tiny (only changed regions are stored)
  const ph = 0; void t;
  const glow = (x: number, y: number, r: number, col: string, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  };
  glow(W * (0.22 + 0.06 * Math.sin(ph)), H * (0.12 + 0.05 * Math.cos(ph)), Math.max(W, H) * 0.55, C.accent, 0.13);
  glow(W * (0.85 + 0.05 * Math.cos(ph)), H * (0.95 + 0.04 * Math.sin(ph)), Math.max(W, H) * 0.5, C.merged, 0.08);
}

// ---------- text helpers ----------
function font(g: Ctx, weight: number, size: number, fam = SANS) { g.font = `${weight} ${size}px "${fam}"`; }

function ellipsize(g: Ctx, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + "…";
}

function wrapWords(g: Ctx, text: string, maxW: number): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    const trial = [...cur, w].join(" ");
    if (cur.length && g.measureText(trial).width > maxW) lines.push([w]); else cur.push(w);
  }
  return lines;
}

function rrect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}

function statusColor(cs: ChangeSet) {
  return cs.state === "merged" ? C.merged : cs.state === "closed" ? C.closed : cs.state === "open" ? C.open : C.accent;
}
function statusLabel(cs: ChangeSet) {
  return cs.state === "merged" ? "Merged" : cs.state === "closed" ? "Closed" : cs.state === "open" ? "Open" : cs.ref ?? "Diff";
}

function pill(g: Ctx, x: number, y: number, h: number, label: string, col: string, S: number, a = 1): number {
  font(g, 600, h * 0.46);
  const tw = g.measureText(label).width;
  const w = tw + h * 1.25 + h * 0.3;
  g.globalAlpha = a;
  rrect(g, x, y, w, h, h / 2); g.fillStyle = hexA(col, 0.16); g.fill();
  g.strokeStyle = hexA(col, 0.45); g.lineWidth = 1.5 * S; g.stroke();
  g.fillStyle = col; g.beginPath(); g.arc(x + h * 0.55, y + h / 2, h * 0.14, 0, Math.PI * 2); g.fill();
  g.textBaseline = "middle"; g.fillText(label, x + h * 0.85, y + h / 2 + 1);
  g.globalAlpha = 1;
  return w;
}

// ---------- scenes ----------
/** Outgoing scene leaves in the first 60% of the overlap, the incoming one arrives in the last 60%. */
function inAlpha(s: Scene, t: number) { return ease.inOut3(prog(t, s.start + XFADE * 0.4, XFADE * 0.6)); }
function outAlpha(s: Scene, t: number) { return 1 - ease.inOut3(prog(t, s.start + s.dur - XFADE, XFADE * 0.6)); }
function outProg(s: Scene, t: number) { return ease.inOut3(prog(t, s.start + s.dur - XFADE, XFADE * 0.6)); }
function sceneAlpha(s: Scene, t: number) { return Math.min(inAlpha(s, t), outAlpha(s, t)); }

function drawChrome(p: Plan, g: Ctx, t: number) {
  // top header: repo · #num, and scene progress ticks
  const { width: W } = p.opts; const S = p.S; const cs = p.cs;
  const title = p.scenes[0];
  const a = ease.out3(prog(t, title.start + title.dur - XFADE, 0.6));
  if (a <= 0) return;
  const outro = p.scenes[p.scenes.length - 1];
  const fadeOut = 1 - ease.inOut3(prog(t, outro.start, XFADE));
  g.globalAlpha = a * fadeOut;
  const M = (p.portrait ? 64 : 96) * S;
  const y = (p.portrait ? 90 : 64) * S;
  font(g, 500, 24 * S, MONO);
  g.textBaseline = "middle";
  g.fillStyle = C.sub; g.fillText(cs.repo, M, y);
  const rw = g.measureText(cs.repo).width;
  if (cs.number) { g.fillStyle = C.accent; g.fillText(` #${cs.number}`, M + rw, y); }
  // progress ticks for code scenes
  const codes = p.scenes.filter((s) => s.kind === "code");
  const tw = 34 * S, gap = 8 * S;
  let x = W - M - codes.length * (tw + gap) + gap;
  for (const s of codes) {
    const f = clamp01((t - s.start) / s.dur);
    rrect(g, x, y - 2 * S, tw, 4 * S, 2 * S); g.fillStyle = C.faint; g.fill();
    if (f > 0) { rrect(g, x, y - 2 * S, tw * f, 4 * S, 2 * S); g.fillStyle = C.accent; g.fill(); }
    x += tw + gap;
  }
  g.globalAlpha = 1;
}

function drawTitle(p: Plan, g: Ctx, s: Scene, t: number) {
  const { width: W, height: H } = p.opts; const S = p.S; const cs = p.cs;
  const u = t - s.start;
  const out = outProg(s, t);
  g.save();
  g.globalAlpha = 1 - out;
  g.translate(0, -40 * S * out);
  const M = (p.portrait ? 72 : 140) * S;
  const maxW = W - 2 * M;
  if (cs.number || cs.ref) {
    const ghost = cs.number ? `#${cs.number}` : (cs.ref ?? "");
    font(g, 700, (p.portrait ? 300 : 380) * S); g.textAlign = "right"; g.textBaseline = "alphabetic";
    const ga = ease.out3(prog(u, 0, 1.6));
    g.fillStyle = hexA(C.text, 0.035 * ga);
    g.fillText(ghost, W + 30 * S - u * 14 * S, H - (p.portrait ? 120 : 30) * S);
    g.textAlign = "left";
  }
  // title fitting
  let size = (p.portrait ? 88 : 86) * S;
  let lines: string[][] = [];
  for (; size >= 44 * S; size -= 4 * S) { font(g, 600, size); lines = wrapWords(g, cs.title, maxW); if (lines.length <= (p.portrait ? 5 : 3)) break; }
  if (lines.length > (p.portrait ? 5 : 3)) { lines = lines.slice(0, p.portrait ? 5 : 3); const last = lines[lines.length - 1]; last.push("…"); }
  const lh = size * 1.12;
  const blockH = 70 * S + lines.length * lh + 150 * S;
  let y = (H - blockH) / 2 + (p.portrait ? -60 * S : 0);
  // repo line
  const a0 = ease.out3(prog(u, 0.05, 0.6));
  g.globalAlpha = (1 - out) * a0;
  const ry = y + 24 * S;
  let x = M;
  const av = 44 * S;
  if (p.avatar) {
    g.save(); g.beginPath(); g.arc(x + av / 2, ry, av / 2, 0, Math.PI * 2); g.clip();
    g.drawImage(p.avatar, x, ry - av / 2, av, av); g.restore();
    x += av + 16 * S;
  }
  font(g, 500, 28 * S, MONO); g.textBaseline = "middle";
  g.fillStyle = C.sub; g.fillText(cs.repo, x, ry + (1 - a0) * 10 * S);
  if (cs.number) { const w = g.measureText(cs.repo).width; g.fillStyle = C.accent; g.fillText(`  #${cs.number}`, x + w, ry + (1 - a0) * 10 * S); }
  y += 70 * S;
  // words, with a white-to-periwinkle gradient across the headline
  font(g, 600, size); g.textBaseline = "alphabetic";
  const titleW = Math.max(...lines.map((l) => g.measureText(l.join(" ")).width));
  const titleFill = g.createLinearGradient(M, 0, M + Math.max(titleW, 1), 0);
  titleFill.addColorStop(0, "#FFFFFF"); titleFill.addColorStop(0.55, "#EEF0FF"); titleFill.addColorStop(1, "#AFBDFF");
  let wi = 0;
  for (const line of lines) {
    let lx = M;
    y += lh;
    for (const w of line) {
      const d = 0.22 + wi * 0.045;
      const e = ease.out5(prog(u, d, 0.7));
      g.globalAlpha = (1 - out) * e;
      g.fillStyle = titleFill;
      g.fillText(w, lx, y + (1 - e) * 36 * S);
      lx += g.measureText(w + " ").width;
      wi++;
    }
  }
  // meta row
  y += 56 * S;
  const mDelay = 0.3 + wi * 0.045;
  const ma = ease.out3(prog(u, mDelay, 0.6));
  g.globalAlpha = (1 - out) * ma;
  const ph = 48 * S;
  x = M;
  x += pill(g, x, y, ph, statusLabel(cs), statusColor(cs), S, (1 - out) * ma) + 22 * S;
  g.globalAlpha = (1 - out) * ma;
  font(g, 500, 26 * S); g.textBaseline = "middle"; g.fillStyle = C.sub;
  const meta = [cs.author ? `@${cs.author}` : "", `${cs.commits} commit${cs.commits === 1 ? "" : "s"}`, `${cs.files.length} file${cs.files.length === 1 ? "" : "s"}`].filter(Boolean).join("   ·   ");
  if (p.portrait) { g.fillText(meta, M, y + ph + 40 * S); } else g.fillText(meta, x, y + ph / 2 + 1);
  // diffstat counters + bar
  const cy = y + ph + (p.portrait ? 120 * S : 78 * S);
  const ca = ease.out3(prog(u, mDelay + 0.15, 1.3));
  g.globalAlpha = (1 - out) * ease.out3(prog(u, mDelay + 0.1, 0.4));
  font(g, 600, 40 * S, MONO); g.textBaseline = "middle";
  const addS = `+${fmt(cs.additions * ca)}`;
  g.fillStyle = C.add; g.fillText(addS, M, cy);
  const addW = g.measureText(`+${fmt(cs.additions)}`).width;
  g.fillStyle = C.del; g.fillText(`−${fmt(cs.deletions * ca)}`, M + addW + 26 * S, cy);
  const delW = g.measureText(`−${fmt(cs.deletions)}`).width;
  const bx = M + addW + delW + 64 * S;
  const bw = Math.min(maxW - (bx - M), 520 * S);
  if (bw > 120 * S) {
    const tot = Math.max(1, cs.additions + cs.deletions);
    const segs = 24; const sw = bw / segs;
    const nAdd = Math.round((cs.additions / tot) * segs);
    for (let i = 0; i < segs; i++) {
      const e = ease.out3(prog(u, mDelay + 0.2 + i * 0.025, 0.35));
      rrect(g, bx + i * sw, cy - 9 * S, sw - 4 * S, 18 * S, 3 * S);
      g.fillStyle = i < nAdd ? hexA(C.add, 0.25 + 0.75 * e) : hexA(C.del, 0.25 + 0.75 * e);
      g.globalAlpha = (1 - out) * e; g.fill();
    }
  }
  g.restore();
}

function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

function drawPath(g: Ctx, path: string, x: number, y: number, maxW: number, dirCol: string, baseCol: string) {
  let { dir, base } = splitPath(path);
  const bw = g.measureText(base).width;
  if (bw > maxW) { base = ellipsize(g, base, maxW); dir = ""; }
  else if (g.measureText(dir).width + bw > maxW) {
    // drop leading directories
    const parts = dir.split("/").filter(Boolean);
    while (parts.length && g.measureText("…/" + parts.join("/") + "/").width + bw > maxW) parts.shift();
    dir = parts.length ? "…/" + parts.join("/") + "/" : "…/";
  }
  g.fillStyle = dirCol; g.fillText(dir, x, y);
  const dw = g.measureText(dir).width;
  g.fillStyle = baseCol; g.fillText(base, x + dw, y);
  return dw + g.measureText(base).width;
}

function drawFiles(p: Plan, g: Ctx, s: Scene, t: number) {
  const { width: W, height: H } = p.opts; const S = p.S; const cs = p.cs;
  const u = t - s.start; const A = sceneAlpha(s, t);
  const outP = outProg(s, t);
  g.save(); g.globalAlpha = A;
  g.translate(0, (1 - ease.out3(prog(u, XFADE * 0.4, 0.6))) * 30 * S - outP * 30 * S);
  const M = (p.portrait ? 64 : 140) * S;
  const top = (p.portrait ? 240 : 150) * S;
  const chosen = new Set(p.hunks.map((h) => h.file));
  const maxRows = p.portrait ? 16 : 9;
  const rank = (f: FileDiff) => (chosen.has(f) ? 1e9 : 0) + (f.additions + f.deletions) * Math.max(0.01, fileWeight(f));
  const files = [...cs.files].sort((a, b) => rank(b) - rank(a));
  const rows = files.slice(0, files.length > maxRows ? maxRows - 1 : maxRows)
    .sort((a, b) => cs.files.indexOf(a) - cs.files.indexOf(b));
  const more = files.length - rows.length;
  // heading
  font(g, 600, 54 * S); g.textBaseline = "alphabetic"; g.fillStyle = C.text;
  g.fillText(`${fmt(cs.files.length)} file${cs.files.length === 1 ? "" : "s"} changed`, M, top + 54 * S);
  font(g, 500, 24 * S, MONO); g.fillStyle = C.dim;
  const hint = p.hunks.length ? `${p.hunks.length} highlight${p.hunks.length === 1 ? "" : "s"} ahead` : "";
  if (!p.portrait) { g.textAlign = "right"; g.fillText(hint, W - M, top + 50 * S); g.textAlign = "left"; }
  const baseRow = (p.portrait ? 74 : 64) * S;
  const avail = H - (top + 110 * S) - (p.portrait ? 200 : 90) * S;
  const k = Math.max(1, Math.min(1.45, avail / ((rows.length + (more > 0 ? 1 : 0)) * baseRow)));
  const rowH = baseRow * k;
  let y = top + 110 * S;
  const maxCh = Math.max(1, ...rows.map((f) => f.additions + f.deletions));
  const spot = ease.inOut3(prog(u, s.dur - XFADE - 0.9, 0.5));
  rows.forEach((f, i) => {
    const e = ease.out5(prog(u, 0.25 + i * 0.06, 0.6));
    const isC = chosen.has(f);
    const rowA = e * (isC ? 1 : 1 - 0.6 * spot);
    g.globalAlpha = A * rowA;
    const ry = y + (1 - e) * 24 * S;
    if (isC) {
      rrect(g, M - 18 * S, ry - rowH / 2 + 6 * S, W - 2 * M + 36 * S, rowH - 12 * S, 12 * S);
      g.fillStyle = hexA(C.accent, 0.10 * spot); g.fill();
      g.strokeStyle = hexA(C.accent, 0.35 * spot); g.lineWidth = 1.5 * S; g.stroke();
    }
    // status glyph
    const st = f.status === "added" ? ["A", C.add] : f.status === "deleted" ? ["D", C.del] : f.status === "renamed" ? ["R", C.accent] : ["M", "#E6B450"];
    const gs = 30 * S * k;
    rrect(g, M, ry - gs / 2, gs, gs, 7 * S); g.fillStyle = hexA(st[1], 0.16); g.fill();
    font(g, 700, 17 * S * k, MONO); g.fillStyle = st[1]; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(st[0], M + gs / 2, ry + 1);
    g.textAlign = "left";
    const barW = (p.portrait ? 150 : 240) * S;
    const numW = (p.portrait ? 170 : 210) * S;
    font(g, 500, (p.portrait ? 27 : 28) * S * k, MONO);
    drawPath(g, f.path, M + gs + 20 * S * k, ry + 1, W - 2 * M - gs - 20 * S - barW - numW - 30 * S, C.dim, isC ? C.text : C.sub);
    // numbers
    font(g, 500, 23 * S * k, MONO); g.textAlign = "right";
    const nx = W - M - barW - 24 * S;
    g.fillStyle = C.del; const dTxt = `−${fmt(f.deletions)}`; g.fillText(dTxt, nx, ry + 1);
    const dw = g.measureText(dTxt).width;
    g.fillStyle = C.add; g.fillText(`+${fmt(f.additions)}`, nx - dw - 14 * S, ry + 1);
    g.textAlign = "left";
    // bar
    const be = ease.out3(prog(u, 0.45 + i * 0.06, 0.8));
    const bx = W - M - barW;
    rrect(g, bx, ry - 5 * S * k, barW, 10 * S * k, 5 * S * k); g.fillStyle = C.faint; g.fill();
    const tot = f.additions + f.deletions;
    const len = barW * Math.max(0.04, Math.sqrt(tot / maxCh)) * be;
    const aw = tot ? len * (f.additions / tot) : 0;
    if (aw > 0) { rrect(g, bx, ry - 5 * S * k, aw, 10 * S * k, 5 * S * k); g.fillStyle = C.add; g.fill(); }
    if (len - aw > 0) { rrect(g, bx + aw, ry - 5 * S * k, len - aw, 10 * S * k, 5 * S * k); g.fillStyle = C.del; g.fill(); }
    y += rowH;
  });
  if (more > 0) {
    g.globalAlpha = A * ease.out3(prog(u, 0.3 + rows.length * 0.06, 0.6)) * (1 - 0.6 * spot);
    font(g, 500, 24 * S, MONO); g.fillStyle = C.dim; g.textBaseline = "middle";
    g.fillText(`+ ${fmt(more)} more`, M + 50 * S, y);
  }
  g.restore();
}

interface LineAnim { start: number; dur: number; insertAt: number }

function codeSchedule(h: PHunk, dur: number) {
  const dels = h.lines.map((l, i) => (l.kind === "del" ? i : -1)).filter((i) => i >= 0);
  const delStart = 0.55;
  const delEnd = dels.length ? delStart + 0.05 * (dels.length - 1) + 0.4 : delStart;
  const addStart = dels.length ? Math.max(0.6, delEnd - 0.1) : 0.42;
  const hold = 1.05;
  const budget = Math.max(0.6, dur - addStart - hold);
  const anim = new Map<number, LineAnim>();
  const adds = h.lines.map((l, i) => (l.kind === "add" ? i : -1)).filter((i) => i >= 0);
  const totalChars = Math.max(1, adds.reduce((a, i) => a + Math.max(6, h.lines[i].text.length), 0));
  let t = addStart;
  // per-line insertion takes a fixed slice, typing the rest, proportional to length
  const ins = Math.min(0.12, budget / Math.max(1, adds.length) / 3);
  const typeBudget = Math.max(0.2, budget - ins * adds.length);
  for (const i of adds) {
    const d = (typeBudget * Math.max(6, h.lines[i].text.length)) / totalChars;
    anim.set(i, { insertAt: t, start: t + ins * 0.6, dur: d });
    t += ins + d;
  }
  dels.forEach((i, k) => anim.set(i, { insertAt: 0, start: delStart + 0.05 * k, dur: 0.4 }));
  return { anim, typingEnd: t, spotAt: Math.min(dur - 0.9, t + 0.1) };
}

interface Seg { s: number; e: number; indent: number }
interface CodeLayout {
  fs: number; lh: number; chW: number; noDigits: number; gutterW: number;
  cw: number; chhFinal: number; cx0: number; cy0: number; z: number;
  lines: number; // number of hunk lines that fit (rest is cut)
  segs: Seg[][];
}

/** Soft-wrap one line to `cols` characters, breaking after spaces or punctuation, with a hanging indent. */
export function wrapLine(text: string, cols: number): Seg[] {
  const len = text.trimEnd().length;
  if (len <= cols) return [{ s: 0, e: text.length, indent: 0 }];
  const lead = Math.min(text.length - text.trimStart().length, Math.floor(cols / 3));
  const indent = lead + 2;
  const out: Seg[] = [];
  let s = 0, first = true;
  while (s < len) {
    const room = first ? cols : cols - indent;
    if (len - s <= room) { out.push({ s, e: len, indent: first ? 0 : indent }); break; }
    let cut = s + room;
    for (let k = cut; k > s + room * 0.55; k--) {
      const ch = text[k - 1];
      if (ch === " " || ch === "," || ch === ";" || ch === "(" || ch === "{" || ch === "[" || ch === "." || ch === ":" || ch === "|" || ch === "&") { cut = k; break; }
    }
    out.push({ s, e: cut, indent: first ? 0 : indent });
    s = cut;
    while (s < len && text[s] === " ") s++; // continuation rows start on a non-space
    first = false;
  }
  return out;
}

const layouts = new WeakMap<object, CodeLayout>();

function layoutCode(p: Plan, g: Ctx, h: PHunk, top: number, maxCw: number, maxCh: number, padX: number, padY: number): CodeLayout {
  const key = h as object;
  const hit = layouts.get(key);
  if (hit) return hit;
  const { width: W, height: H } = p.opts; const S = p.S; const P = p.portrait;
  const maxNo = Math.max(...h.lines.map((l) => l.no ?? 0));
  const noDigits = Math.max(2, String(maxNo).length);
  const fsMax = (P ? 40 : 38) * S, fsMin = (P ? 27 : 21) * S;
  let best: Omit<CodeLayout, "cw" | "chhFinal" | "cx0" | "cy0" | "z"> | null = null;
  for (let fs = fsMax; fs >= fsMin - 0.01; fs -= 1 * S) {
    font(g, 400, fs, MONO);
    const chW = g.measureText("0").width;
    const lh = fs * 1.55;
    const gutterW = (noDigits + 1.4) * chW + 20 * S;
    const cols = Math.max(16, Math.floor((maxCw - 2 * padX - gutterW) / chW) - 1);
    const segs = h.lines.map((l) => wrapLine(l.text, cols));
    const rows = segs.reduce((a, r) => a + r.length, 0);
    const cand = { fs, lh, chW, noDigits, gutterW, lines: h.lines.length, segs };
    // prefer a size where nothing wraps; accept wrapping only once the font would get small
    const wraps = segs.some((r) => r.length > 1);
    if (rows * lh + 2 * padY <= maxCh) {
      if (!wraps || fs <= (P ? 34 : 28) * S) { best = cand; break; }
      best ??= cand; // remember the biggest wrapped fit in case a non-wrapping one never comes
    }
  }
  if (!best) {
    // still too tall at the smallest size: keep as many whole lines as fit
    font(g, 400, fsMin, MONO);
    const chW = g.measureText("0").width, lh = fsMin * 1.55;
    const gutterW = (noDigits + 1.4) * chW + 20 * S;
    const cols = Math.max(16, Math.floor((maxCw - 2 * padX - gutterW) / chW) - 1);
    const segs: Seg[][] = [];
    let rows = 0;
    for (const l of h.lines) { const r = wrapLine(l.text, cols); if ((rows + r.length) * lh + 2 * padY > maxCh) break; segs.push(r); rows += r.length; }
    best = { fs: fsMin, lh, chW, noDigits, gutterW, lines: segs.length, segs };
  }
  const maxRowChars = Math.max(24, ...best.segs.flat().map((sg, _i) => sg.e - sg.s + sg.indent));
  const cw = Math.min(maxCw, Math.max(maxCw * (P ? 1 : 0.62), 2 * padX + best.gutterW + (maxRowChars + 2) * best.chW));
  const rowsAll = best.segs.reduce((a, r) => a + r.length, 0);
  const chhFinal = Math.min(maxCh, rowsAll * best.lh + 2 * padY);
  const cx0 = (W - cw) / 2;
  const cy0 = top + (maxCh - chhFinal) * (P ? 0.3 : 0.2);
  // push-in amount that never leaves the safe area (no clipping)
  const above = cy0 - (top - 18 * S), below = H - 20 * S - (cy0 + chhFinal), side = (W - 24 * S * 2 - cw) / 2;
  const z = 1 + Math.max(0, Math.min(0.06, (2 * Math.min(above, below)) / chhFinal, (2 * side) / cw));
  const lay = { ...best, cw, chhFinal, cx0, cy0, z };
  layouts.set(key, lay);
  return lay;
}

function drawCode(p: Plan, g: Ctx, s: Scene, t: number) {
  const h = p.hunks[s.hunk!];
  const { width: W, height: H } = p.opts; const S = p.S;
  const u = t - s.start; const A = sceneAlpha(s, t);
  const outP = outProg(s, t);
  const inP = ease.out5(prog(u, XFADE * 0.4, 0.75));
  const P = p.portrait;
  // ---- chapter heading ----
  const mX = (P ? 44 : 120) * S;
  const headTop = (P ? 190 : 112) * S;
  const idx = String(s.hunk! + 1).padStart(2, "0");
  const ha = ease.out3(prog(u, XFADE * 0.4, 0.6));
  g.save();
  g.globalAlpha = A * ha;
  g.translate(0, (1 - ha) * 18 * S - outP * 20 * S);
  font(g, 600, 26 * S, MONO); g.textBaseline = "alphabetic"; g.fillStyle = C.accent;
  g.fillText(`${idx}`, mX, headTop + 36 * S);
  const iw = g.measureText(`${idx}`).width + 18 * S;
  g.fillStyle = C.dim; g.fillText(`/ ${String(p.hunks.length).padStart(2, "0")}`, mX + iw, headTop + 36 * S);
  const { dir, base } = splitPath(h.file.path);
  font(g, 600, (P ? 52 : 46) * S); g.fillStyle = C.text;
  g.fillText(ellipsize(g, base, W - 2 * mX - (P ? 0 : 220 * S)), mX, headTop + 98 * S);
  font(g, 500, (P ? 24 : 22) * S, MONO);
  let sub = dir ? dir.replace(/\/$/, "") : "";
  if (h.header) sub = sub ? `${sub}  ›  ${h.header}` : h.header;
  g.fillStyle = C.dim;
  g.fillText(ellipsize(g, sub, W - 2 * mX - (P ? 0 : 220 * S)), mX, headTop + 136 * S);
  font(g, 600, 26 * S, MONO); g.textAlign = "right";
  const rx = W - mX;
  const dTxt = `−${fmt(h.file.deletions)}`;
  const statY = P ? headTop + 36 * S : headTop + 94 * S;
  g.fillStyle = C.del; g.fillText(dTxt, rx, statY);
  g.fillStyle = C.add; g.fillText(`+${fmt(h.file.additions)}`, rx - g.measureText(dTxt).width - 16 * S, statY);
  g.textAlign = "left";
  g.restore();

  // ---- card ----
  const top = headTop + 168 * S;
  const bottom = (P ? 150 : 56) * S;
  const maxCw = W - 2 * mX, maxCh = H - top - bottom;
  const padX = (P ? 28 : 34) * S, padY = 28 * S;
  const L = layoutCode(p, g, h, top, maxCw, maxCh, padX, padY);
  const { fs, lh, chW, noDigits, gutterW, cw, cx0, cy0 } = L;
  const lines = h.lines.slice(0, L.lines);
  const sched = codeSchedule({ ...h, lines }, s.dur);
  const heights = lines.map((l, i) => {
    const rows = L.segs[i].length;
    if (l.kind !== "add") return rows;
    return rows * ease.out3(prog(u, sched.anim.get(i)!.insertAt, 0.2));
  });
  const totalH = heights.reduce((a, b) => a + b, 0) * lh;
  const chh = Math.min(L.chhFinal, Math.max(Math.min(lines.length, 3) * lh, totalH) + 2 * padY);
  // camera: a gentle push-in while typing, back out for the spotlight; sized so the card never clips
  const zoomIn = ease.inOut3(prog(u, 0.3, 1.6)) * (1 - ease.inOut3(prog(u, sched.spotAt - 0.1, 0.8)));
  const scale = lerp(0.965, 1, inP) * (1 + (L.z - 1) * zoomIn) * (1 - 0.02 * outP);
  g.save();
  g.globalAlpha = A;
  const pivotY = cy0 + L.chhFinal / 2;
  // code cards move like a carousel: in from the right, out to the left
  g.translate(W / 2 + (1 - inP) * 90 * S - outP * 90 * S, pivotY + (1 - inP) * 16 * S);
  g.scale(scale, scale);
  g.translate(-W / 2, -pivotY);
  { // soft colored light behind the card, tinted by the change (green adds, red deletes)
    const tint = h.adds >= h.dels ? C.add : C.del;
    const gl = g.createRadialGradient(W / 2, cy0 + chh * 0.6, 0, W / 2, cy0 + chh * 0.6, Math.max(cw, chh) * 0.75);
    gl.addColorStop(0, hexA(tint, 0.09)); gl.addColorStop(0.5, hexA(C.accent, 0.04)); gl.addColorStop(1, hexA(C.accent, 0));
    g.fillStyle = gl; g.fillRect(cx0 - cw * 0.3, cy0 - chh * 0.4, cw * 1.6, chh * 1.8);
  }
  g.save();
  g.shadowColor = "rgba(0,0,0,0.65)"; g.shadowBlur = 70 * S; g.shadowOffsetY = 28 * S;
  rrect(g, cx0, cy0, cw, chh, 22 * S); g.fillStyle = C.panel; g.fill();
  g.restore();
  const cg = g.createLinearGradient(0, cy0, 0, cy0 + chh);
  cg.addColorStop(0, "rgba(255,255,255,0.03)"); cg.addColorStop(1, "rgba(255,255,255,0)");
  rrect(g, cx0, cy0, cw, chh, 22 * S); g.fillStyle = cg; g.fill();
  g.strokeStyle = C.border; g.lineWidth = 1.5 * S; g.stroke();
  const lc = LANG_COLOR[h.lang] ?? LANG_COLOR.text;
  g.fillStyle = lc; g.globalAlpha = A * 0.9;
  g.beginPath(); g.arc(cx0 + cw - 22 * S, cy0 + 22 * S, 5 * S, 0, Math.PI * 2); g.fill();
  g.globalAlpha = A;

  const codeX = cx0 + padX + gutterW;
  const spot = ease.inOut3(prog(u, sched.spotAt, 0.5));
  let y = cy0 + padY;
  g.save();
  rrect(g, cx0, cy0, cw, chh, 22 * S); g.clip();
  let cursor: { x: number; y: number } | null = null;
  lines.forEach((l, i) => {
    const hh = heights[i] * lh;
    if (hh < 0.5) return;
    const an = sched.anim.get(i);
    const segs = L.segs[i];
    const rowAlpha = l.kind === "add" ? heights[i] / segs.length : 1;
    if (l.kind === "add" && an) {
      const sweep = ease.out3(prog(u, an.insertAt, an.dur + 0.25));
      const grd = g.createLinearGradient(cx0, 0, cx0 + cw, 0);
      grd.addColorStop(0, hexA(C.add, 0.22)); grd.addColorStop(1, hexA(C.add, 0.04));
      g.globalAlpha = A * rowAlpha * (0.35 + 0.65 * sweep);
      g.fillStyle = grd; g.fillRect(cx0, y, cw * Math.max(0.02, sweep), hh);
      g.fillStyle = C.add; g.fillRect(cx0, y, 4 * S, hh);
    } else if (l.kind === "del" && an) {
      const sweep = ease.out3(prog(u, an.start, an.dur));
      g.globalAlpha = A * sweep;
      const grd = g.createLinearGradient(cx0, 0, cx0 + cw, 0);
      grd.addColorStop(0, hexA(C.del, 0.2)); grd.addColorStop(1, hexA(C.del, 0.04));
      g.fillStyle = grd; g.fillRect(cx0, y, cw * sweep, hh);
      g.fillStyle = C.del; g.fillRect(cx0, y, 4 * S, hh);
    }
    const dimK = l.kind === "ctx" ? 1 - 0.55 * spot : l.kind === "del" ? 1 - 0.3 * spot : 1;
    // gutter on the first row only
    const cy1 = y + lh / 2;
    font(g, 400, fs * 0.86, MONO); g.textBaseline = "middle"; g.textAlign = "right";
    g.globalAlpha = A * rowAlpha * dimK * (l.kind === "ctx" ? 0.8 : 1);
    g.fillStyle = l.kind === "add" ? hexA(C.add, 0.85) : l.kind === "del" ? hexA(C.del, 0.85) : C.dim;
    g.fillText(l.no != null ? String(l.no) : "", cx0 + padX + noDigits * chW * 0.86, cy1);
    g.textAlign = "left";
    const mark = l.kind === "add" ? "+" : l.kind === "del" ? "−" : "";
    if (mark) g.fillText(mark, cx0 + padX + (noDigits + 0.7) * chW, cy1);
    font(g, 400, fs, MONO);
    let shown = l.text.length;
    if (l.kind === "add" && an) shown = Math.floor(l.text.length * clamp01((u - an.start) / an.dur));
    const delP = l.kind === "del" && an ? ease.out3(prog(u, an.start, an.dur)) : 0;
    const textA = A * rowAlpha * dimK * (l.kind === "del" ? 1 - 0.35 * delP : 1);
    segs.forEach((sg, r) => {
      const ry = y + r * lh + lh / 2;
      if (ry - lh / 2 > y + hh) return;
      const x0 = codeX + sg.indent * chW;
      if (r > 0 && shown > sg.s) { // continuation marker
        g.globalAlpha = textA * 0.5; g.fillStyle = C.dim;
        g.fillText("↪", codeX + Math.max(0, sg.indent - 2) * chW, ry);
      }
      let x = x0, pos = 0;
      const end = Math.min(sg.e, shown);
      for (const tk of l.toks) {
        const a = pos, b = pos + tk.text.length; pos = b;
        if (b <= sg.s) continue;
        if (a >= end) break;
        const txt = tk.text.slice(Math.max(0, sg.s - a), Math.min(tk.text.length, end - a));
        if (!txt) continue;
        g.fillStyle = l.kind === "del" ? mixColor(tk.color, C.del, 0.55 * delP) : tk.color;
        g.globalAlpha = textA;
        g.fillText(txt, x, ry);
        x += g.measureText(txt).width;
      }
      if (l.kind === "del" && delP > 0 && l.text.slice(sg.s, sg.e).trim()) {
        const lead = r === 0 ? (l.text.length - l.text.trimStart().length) * chW : 0;
        const segLen = l.text.slice(sg.s, sg.e).trimEnd().length * chW;
        g.globalAlpha = A * 0.75 * dimK;
        g.fillStyle = C.del; g.fillRect(x0 + lead, ry, (segLen - lead) * delP, 1.6 * S);
      }
      if (l.kind === "add" && an && u >= an.insertAt && u < an.start + an.dur + 0.15 && shown >= sg.s && (shown < sg.e || r === segs.length - 1)) cursor = { x, y: ry };
    });
    y += hh;
  });
  if (cursor) {
    const c = cursor as { x: number; y: number };
    g.globalAlpha = A; g.fillStyle = C.accent;
    g.shadowColor = C.accent; g.shadowBlur = 18 * S;
    g.fillRect(c.x + 2 * S, c.y - fs * 0.62, Math.max(2, 3 * S), fs * 1.24);
    g.shadowBlur = 0;
  }
  g.restore();
  g.restore();
}

function mixColor(a: string, b: string, k: number) {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  return `rgb(${Math.round(lerp(pa[0], pb[0], k))},${Math.round(lerp(pa[1], pb[1], k))},${Math.round(lerp(pa[2], pb[2], k))})`;
}
function parseHex(c: string): number[] | null {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  if (!m) return null;
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function drawOutro(p: Plan, g: Ctx, s: Scene, t: number) {
  const { width: W, height: H } = p.opts; const S = p.S; const cs = p.cs;
  const u = t - s.start;
  const inA = inAlpha(s, t);
  const endFade = ease.inOut3(clamp01((t - (p.opts.duration - 0.55)) / 0.55));
  g.save();
  g.globalAlpha = inA * (1 - endFade);
  const cx = W / 2;
  const col = statusColor(cs);
  // badge
  const tall = H > W * 1.3;
  const by = H / 2 - (tall ? 380 : p.portrait ? 360 : 175) * S;
  const be = ease.back(prog(u, 0.15, 0.6));
  const r = 40 * S * be;
  if (r > 0) {
    g.fillStyle = hexA(col, 0.16); g.beginPath(); g.arc(cx, by, r * 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(cx, by, r, 0, Math.PI * 2); g.fill();
    // check mark drawn progressively
    const ce = ease.out3(prog(u, 0.4, 0.4));
    g.strokeStyle = C.bg; g.lineWidth = 7 * S; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    const p1 = [cx - 15 * S, by + 1 * S], p2 = [cx - 4 * S, by + 12 * S], p3 = [cx + 17 * S, by - 11 * S];
    g.moveTo(p1[0], p1[1]);
    const seg1 = Math.min(1, ce * 2.2);
    g.lineTo(lerp(p1[0], p2[0], seg1), lerp(p1[1], p2[1], seg1));
    if (ce > 0.45) { const s2 = (ce - 0.45) / 0.55; g.lineTo(lerp(p2[0], p3[0], s2), lerp(p2[1], p3[1], s2)); }
    g.stroke();
  }
  const ta = ease.out3(prog(u, 0.35, 0.6));
  g.globalAlpha = inA * (1 - endFade) * ta;
  font(g, 600, 30 * S); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = col;
  g.fillText(cs.state === "merged" ? "Merged" : cs.state === "range" ? (cs.ref ?? "") : statusLabel(cs), cx, by + 92 * S);
  font(g, 500, (p.portrait ? 40 : 40) * S); g.fillStyle = C.text;
  const tMax = W - (p.portrait ? 140 : 360) * S;
  let tl = wrapWords(g, cs.title, tMax).map((l) => l.join(" "));
  if (tl.length > 2) tl = [tl[0], ellipsize(g, tl.slice(1).join(" "), tMax)];
  if (!p.portrait) tl = [ellipsize(g, cs.title, tMax)];
  tl.forEach((l, i) => g.fillText(l, cx, by + 150 * S + i * 52 * S));
  const extra = (tl.length - 1) * 52 * S;
  // stats grid
  const stats: [string, number, string][] = [
    ["additions", cs.additions, C.add], ["deletions", cs.deletions, C.del],
    ["files", cs.files.length, C.text], [cs.commits === 1 ? "commit" : "commits", cs.commits, C.text],
  ];
  const cols = p.portrait ? 2 : 4;
  const cellW = (p.portrait ? 440 : 360) * S, cellH = (tall ? 230 : p.portrait ? 190 : 200) * S;
  const gx = cx - (cols * cellW) / 2;
  const gy = by + (p.portrait ? 260 : 230) * S + extra;
  stats.forEach(([label, val, c], i) => {
    const e = ease.out5(prog(u, 0.45 + i * 0.09, 0.8));
    const ce = ease.out3(prog(u, 0.45 + i * 0.09, 1.4));
    const x = gx + (i % cols) * cellW + cellW / 2;
    const y = gy + Math.floor(i / cols) * cellH + (1 - e) * 30 * S;
    g.globalAlpha = inA * (1 - endFade) * e;
    font(g, 600, (p.portrait ? 96 : 92) * S, MONO); g.fillStyle = c;
    const prefix = i === 0 ? "+" : i === 1 ? "−" : "";
    g.fillText(prefix + fmt(val * ce), x, y + 50 * S);
    font(g, 500, 24 * S, MONO); g.fillStyle = C.dim;
    g.fillText(label.toUpperCase(), x, y + 128 * S);
  });
  // footer
  g.globalAlpha = inA * (1 - endFade) * ease.out3(prog(u, 0.9, 0.6));
  font(g, 500, 22 * S, MONO); g.fillStyle = C.dim;
  g.fillText(cs.url ? cs.url.replace(/^https:\/\//, "") : cs.repo, cx, H - (p.portrait ? 170 : 92) * S);
  if (p.opts.brand !== false) {
    font(g, 600, 20 * S, MONO); g.fillStyle = hexA(C.text, 0.35);
    g.fillText("made with prcine", cx, H - (p.portrait ? 128 : 56) * S);
  }
  g.textAlign = "left";
  g.restore();
}

export function drawFrame(p: Plan, g: Ctx, t: number) {
  drawBg(p, g, t);
  for (const s of p.scenes) {
    if (t < s.start || t > s.start + s.dur) continue;
    if (s.kind === "title") drawTitle(p, g, s, t);
    else if (s.kind === "files") drawFiles(p, g, s, t);
    else if (s.kind === "code") drawCode(p, g, s, t);
    else drawOutro(p, g, s, t);
  }
  drawChrome(p, g, t);
}

export function makeCanvas(p: Plan) {
  const c = new Canvas(p.opts.width, p.opts.height);
  return { canvas: c, ctx: c.getContext("2d") };
}
