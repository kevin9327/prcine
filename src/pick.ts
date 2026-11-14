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

const TEST = /(^|\/)(tests?|__tests__|specs?|e2e|testing|testdata|__mocks__|fixtures?)\/|(^|\/)test_[^/]+\.py$|[._-](test|spec)s?\.\w+$|_test\.\w+$|(Test|Tests|Spec)\.(java|kt|swift|cs|scala)$|_spec\.rb$/;
const AUX = /(^|\/)(examples?|docs?|scripts?|bench(marks?)?|demos?|samples?|playground|website|\.github)\//i;
const CORE = /(^|\/)(src|lib|core|internal|pkg|app|crates\/[^/]+\/src|packages\/[^/]+\/src)\//;

export function isTestPath(path: string) { return TEST.test(path); }

/** True when every non-test code file sits in an aux folder (e.g. a repo whose code lives in scripts/): then aux is the core. */
export function auxIsCore(cs: ChangeSet): boolean {
  return !cs.files.some((f) => !f.binary && !NOISE.some((r) => r.test(f.path)) && !TEST.test(f.path) && !AUX.test(f.path) && !/\.(md|mdx|txt|rst|json|ya?ml|toml|ini|cfg|xml|csv|lock)$/i.test(f.path));
}

export function fileWeight(f: FileDiff, relaxAux = false): number {
  if (f.binary || f.hunks.length === 0) return 0;
  if (NOISE.some((r) => r.test(f.path))) return 0.05;
  let w = 1;
  if (TEST.test(f.path)) w *= 0.25;
  else if (AUX.test(f.path)) w *= relaxAux ? 1 : 0.45;
  else if (CORE.test(f.path)) w *= 1.2;
  if (/\.(md|mdx|txt|rst)$/i.test(f.path)) w *= 0.35;
  if (/\.(json|ya?ml|toml|ini|cfg|xml|csv|lock)$/i.test(f.path)) w *= 0.45;
  if (/(^|\/)(CHANGELOG|LICENSE|AUTHORS|CODEOWNERS)/i.test(f.path)) w *= 0.1;
  return w;
}

const COMMENT = /^\s*(\/\/|\/\*|\*|#(?![\[!]|include|define|if|endif|pragma)|--|;;|<!--|"""|''')/;

/** How much a single changed line is worth showing: real code 1, comments and prose/help text much less. */
export function lineValue(text: string): number {
  const t = text.trim();
  const alnum = (t.match(/[A-Za-z0-9_]/g) ?? []).length;
  if (alnum < 2) return 0.15; // braces, blank-ish lines
  if (COMMENT.test(text)) return 0.25;
  // share of characters inside string literals
  let inStr = 0, q: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === "\\") { i++; inStr++; continue; } if (c === q) q = null; else inStr++; }
    else if (c === '"' || c === "'" || c === "`") q = c;
  }
  if (inStr / t.length > 0.6) return 0.25;
  // prose / CLI help: many words, little code punctuation, or column-aligned text
  const words = (t.match(/[A-Za-z]{3,}/g) ?? []).length;
  const punct = (t.match(/[(){}\[\]=;<>.,:&|+*\/!?]/g) ?? []).length;
  if (words >= 4 && punct / t.length < 0.05) return 0.2;
  if (words >= 3 && / {3,}\S/.test(t)) return 0.2;
  return 1;
}

const changed = (l: DiffLine) => l.kind !== "ctx";

function windowScore(w: DiffLine[]): number {
  let v = 0, adds = 0;
  for (const l of w) if (changed(l)) { v += lineValue(l.text); if (l.kind === "add") adds++; }
  const mixed = w.some((l) => l.kind === "add") && w.some((l) => l.kind === "del") ? 1.15 : 1;
  const typing = adds >= 2 ? 1.1 : 1; // additions are what the video animates best
  return v * mixed * typing;
}

/** Best contiguous window of at most `maxLines` lines inside a hunk. */
export function bestWindow(lines: DiffLine[], maxLines: number): { start: number; end: number; score: number } {
  if (lines.length <= maxLines) return trim(lines, 0, lines.length);
  let best = { start: 0, end: maxLines, score: -1 };
  for (let s = 0; s + maxLines <= lines.length; s++) {
    const sc = windowScore(lines.slice(s, s + maxLines));
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
  return { start: s, end: e, score: windowScore(lines.slice(s, e)) };
}

/**
 * Pick up to `count` windows. Candidates are the best two hunks of every file, weighted by how
 * central the file is. Weak candidates (tests, docs, help text) only make it in when they are
 * close to the best one, so a small PR gets fewer, better highlights instead of filler.
 */
export function pickHighlights(cs: ChangeSet, count: number, maxLines: number): Highlight[] {
  const relax = auxIsCore(cs);
  const weight = (f: FileDiff) => fileWeight(f, relax);
  const cands: Highlight[] = [];
  for (const f of cs.files) {
    const w = weight(f);
    if (w <= 0) continue;
    const perFile: Highlight[] = [];
    for (const h of f.hunks) {
      const win = bestWindow(h.lines, maxLines);
      if (win.score <= 0) continue;
      const sc = (Math.min(win.score, maxLines) + (win.score >= 3 ? 2 : 0)) * w;
      perFile.push({ file: f, lines: h.lines.slice(win.start, win.end), header: h.header, score: sc });
    }
    perFile.sort((a, b) => b.score - a.score);
    cands.push(...perFile.slice(0, 2));
  }
  cands.sort((a, b) => b.score - a.score);
  if (!cands.length) return [];
  const top = cands[0].score;
  const chosen: Highlight[] = [];
  const perFileCount = new Map<FileDiff, number>();
  for (const c of cands) {
    if (chosen.length >= count) break;
    const nth = perFileCount.get(c.file) ?? 0;
    const weak = weight(c.file) < 0.9; // tests, docs, examples, config
    const bar = nth ? 0.5 : weak ? 0.6 : 0.25;
    if (chosen.length && c.score < top * bar) continue;
    chosen.push(c);
    perFileCount.set(c.file, nth + 1);
  }
  // the fix itself must be on screen: if only tests/docs won, swap the best source hunk in
  const isSource = (h: Highlight) => !TEST.test(h.file.path) && weight(h.file) >= 0.9;
  if (!chosen.some(isSource)) {
    const src = cands.find(isSource);
    if (src) { if (chosen.length >= count) chosen.pop(); chosen.unshift(src); }
  }
  // a single fix still gets "fix, then proof": fill one free slot from another file (usually its test)
  for (const c of cands) {
    if (chosen.length !== 1 || chosen.length >= count) break;
    if (chosen.includes(c) || chosen.some((x) => x.file === c.file)) continue;
    if (c.score >= top * 0.2) chosen.push(c);
  }
  // source first, then tests/docs/config; within each group keep the PR's file and hunk order
  const order = new Map(cs.files.map((f, i) => [f, i]));
  const tier = (h: Highlight) => (weight(h.file) >= 1 ? 0 : 1);
  const hunkPos = (h: Highlight) => h.file.hunks.findIndex((x) => x.lines.includes(h.lines[0]));
  return chosen.sort((a, b) => tier(a) - tier(b) || order.get(a.file)! - order.get(b.file)! || hunkPos(a) - hunkPos(b));
}
