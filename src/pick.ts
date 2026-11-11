import type { ChangeSet, DiffLine, FileDiff } from "./types.js";

export interface Highlight {
  file: FileDiff;
  lines: DiffLine[];
  header: string;
  score: number;
}

const NOISE = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock|flake\.lock)$/,
  /(^|\/)(dist|build|vendor|node_modules|third_party|__snapshots__|generated|gen)\//,
  /\.(min\.js|min\.css|map|snap|svg|png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|lock)$/,
  /\.(pb\.go|g\.dart|generated\.\w+)$/,
];

export function fileWeight(f: FileDiff): number {
  if (f.binary || f.hunks.length === 0) return 0;
  if (NOISE.some((r) => r.test(f.path))) return 0.05;
  let w = 1;
  if (/(^|\/)(test|tests|__tests__|spec)\/|[._-](test|spec)\.\w+$|_test\.go$/.test(f.path)) w *= 0.3;
  if (/\.(md|mdx|txt|rst)$/i.test(f.path)) w *= 0.35;
  if (/\.(json|ya?ml|toml|ini|cfg|xml|csv)$/i.test(f.path)) w *= 0.45;
  if (/(^|\/)(CHANGELOG|LICENSE)/i.test(f.path)) w *= 0.1;
  return w;
}

const isSubstantive = (l: DiffLine) => l.kind !== "ctx" && l.text.trim().length > 1;

/** Best contiguous window of at most `maxLines` lines inside a hunk. */
export function bestWindow(lines: DiffLine[], maxLines: number): { start: number; end: number; score: number } {
  if (lines.length <= maxLines) return trim(lines, 0, lines.length);
  let best = { start: 0, end: maxLines, score: -1 };
  for (let s = 0; s + maxLines <= lines.length; s++) {
    const w = lines.slice(s, s + maxLines);
    const subs = w.filter(isSubstantive).length;
    const mixed = w.some((l) => l.kind === "add") && w.some((l) => l.kind === "del") ? 1.15 : 1;
    // prefer windows that start on a context/changed boundary
    const sc = subs * mixed;
    if (sc > best.score) best = { start: s, end: s + maxLines, score: sc };
  }
  return trim(lines, best.start, best.end);
}

function trim(lines: DiffLine[], start: number, end: number) {
  // keep at most 2 context lines at each edge
  let s = start, e = end;
  let lead = 0; while (s + lead < e && lines[s + lead].kind === "ctx") lead++;
  if (lead > 2) s += lead - 2;
  let tail = 0; while (e - 1 - tail >= s && lines[e - 1 - tail].kind === "ctx") tail++;
  if (tail > 2) e -= tail - 2;
  const w = lines.slice(s, e);
  const subs = w.filter(isSubstantive).length;
  const mixed = w.some((l) => l.kind === "add") && w.some((l) => l.kind === "del") ? 1.15 : 1;
  return { start: s, end: e, score: subs * mixed };
}

export function pickHighlights(cs: ChangeSet, count: number, maxLines: number): Highlight[] {
  const cands: Highlight[] = [];
  for (const f of cs.files) {
    const w = fileWeight(f);
    if (w <= 0) continue;
    let bestH: Highlight | null = null;
    for (const h of f.hunks) {
      const win = bestWindow(h.lines, maxLines);
      if (win.score <= 0) continue;
      // diminishing returns for huge windows; small sweet-spot bonus for 4..maxLines changes
      const sc = Math.min(win.score, maxLines) * w + (win.score >= 3 ? 2 : 0) * w;
      if (!bestH || sc > bestH.score) bestH = { file: f, lines: h.lines.slice(win.start, win.end), header: h.header, score: sc };
    }
    if (bestH) cands.push(bestH);
  }
  cands.sort((a, b) => b.score - a.score);
  const chosen = cands.slice(0, count);
  // source first, then tests/docs/config; within each group keep the PR's file order
  const order = new Map(cs.files.map((f, i) => [f, i]));
  const tier = (h: Highlight) => (fileWeight(h.file) >= 1 ? 0 : 1);
  return chosen.sort((a, b) => tier(a) - tier(b) || order.get(a.file)! - order.get(b.file)!);
}
