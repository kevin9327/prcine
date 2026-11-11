import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHunks, parseGitDiff } from "../dist/diff.js";
import { parsePrRef, loadRange } from "../dist/source.js";
import { pickHighlights, bestWindow, fileWeight } from "../dist/pick.js";
import { plan, drawFrame, makeCanvas, totalFrames } from "../dist/render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PATCH = `@@ -1,4 +1,5 @@ function main()
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 console.log(a, b);
\\ No newline at end of file`;

test("parseHunks tracks line numbers and kinds", () => {
  const [h] = parseHunks(PATCH);
  assert.equal(h.header, "function main()");
  assert.deepEqual(h.lines.map((l) => l.kind), ["ctx", "del", "add", "add", "ctx"]);
  assert.equal(h.lines[1].oldNo, 2);
  assert.equal(h.lines[3].newNo, 3);
  assert.equal(h.lines[4].newNo, 4);
});

test("parseGitDiff handles new, renamed and binary files", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/x.ts", "@@ -0,0 +1,2 @@", "+one", "+two",
    "diff --git a/old.go b/new.go", "similarity index 90%", "rename from old.go", "rename to new.go", "--- a/old.go", "+++ b/new.go", "@@ -1 +1 @@", "-x", "+y",
    "diff --git a/img.png b/img.png", "Binary files a/img.png and b/img.png differ", "",
  ].join("\n");
  const files = parseGitDiff(diff);
  assert.equal(files.length, 3);
  assert.equal(files[0].status, "added");
  assert.equal(files[0].additions, 2);
  assert.equal(files[1].status, "renamed");
  assert.equal(files[1].oldPath, "old.go");
  assert.equal(files[1].path, "new.go");
  assert.equal(files[2].binary, true);
});

test("parsePrRef accepts URLs and shorthand, rejects ranges", () => {
  assert.deepEqual(parsePrRef("https://github.com/vitejs/vite/pull/24044/files"), { owner: "vitejs", repo: "vite", number: 24044 });
  assert.deepEqual(parsePrRef("facebook/react#38128"), { owner: "facebook", repo: "react", number: 38128 });
  assert.equal(parsePrRef("main...HEAD"), null);
});

test("fileWeight demotes lockfiles, tests and docs", () => {
  const f = (path) => ({ path, status: "modified", additions: 1, deletions: 0, binary: false, hunks: [{ lines: [] }] });
  assert.ok(fileWeight(f("src/app.ts")) > fileWeight(f("src/app.test.ts")));
  assert.ok(fileWeight(f("src/app.ts")) > fileWeight(f("README.md")));
  assert.ok(fileWeight(f("pnpm-lock.yaml")) < 0.1);
});

test("bestWindow keeps the densest slice and trims context", () => {
  const ctx = (n) => Array.from({ length: n }, () => ({ kind: "ctx", text: "x" }));
  const lines = [...ctx(10), { kind: "del", text: "old()" }, { kind: "add", text: "new()" }, ...ctx(10)];
  const w = bestWindow(lines, 8);
  const slice = lines.slice(w.start, w.end);
  assert.ok(slice.some((l) => l.kind === "add") && slice.some((l) => l.kind === "del"));
  assert.ok(slice.length <= 6, `context trimmed, got ${slice.length}`);
});

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "prcine-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com"); g("config", "user.name", "Test");
  writeFileSync(join(dir, "app.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n");
  g("add", "."); g("commit", "-qm", "init");
  g("checkout", "-qb", "feature");
  writeFileSync(join(dir, "app.ts"), "export function add(a: number, b: number): number {\n  // fast path\n  return a + b;\n}\n\nexport const sub = (a: number, b: number) => a - b;\n");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "."); g("commit", "-qm", "feat: add sub");
  return dir;
}

test("loadRange reads a git range", () => {
  const dir = fixtureRepo();
  const cs = loadRange("main...feature", dir);
  assert.equal(cs.files.length, 2);
  assert.equal(cs.commits, 1);
  assert.equal(cs.title, "feat: add sub");
  const single = loadRange("feature", dir);
  assert.equal(single.files.length, 2);
  const hs = pickHighlights(cs, 1, 13);
  assert.equal(hs[0].file.path, "app.ts");
});

test("plan fills the requested duration and frames render", async () => {
  const dir = fixtureRepo();
  const cs = loadRange("main...feature", dir);
  for (const [width, height] of [[640, 360], [360, 640]]) {
    const p = await plan(cs, { width, height, fps: 10, duration: 12, avatar: false });
    const last = p.scenes[p.scenes.length - 1];
    assert.ok(Math.abs(last.start + last.dur - 12) < 1e-6);
    assert.equal(totalFrames(p), 120);
    const { canvas, ctx } = makeCanvas(p);
    for (let t = 0; t < 12; t += 0.7) drawFrame(p, ctx, t);
    assert.equal(canvas.data().length, width * height * 4);
  }
});

test("cli writes stills for a git range", () => {
  const dir = fixtureRepo();
  const out = join(dir, "out", "demo");
  execFileSync(process.execPath, [join(root, "dist/cli.js"), "main...feature", "-C", dir, "-o", out, "--size", "360", "--still", "5", "--still-only"], { stdio: "pipe" });
  assert.ok(existsSync(`${out}-5.00s.png`));
  assert.ok(statSync(`${out}-5.00s.png`).size > 1000);
});

test("animated WebP muxer writes a valid RIFF with one ANMF per changed frame", async () => {
  const { diffRect, imageChunks, muxAnimation } = await import("../dist/webp.js");
  const { Canvas } = await import("@napi-rs/canvas");
  const a = new Uint8Array(8 * 4 * 4), b = new Uint8Array(a);
  assert.equal(diffRect(a, b, 8, 4), null);
  b[(2 * 8 + 5) * 4] = 9; // pixel (5,2)
  assert.deepEqual(diffRect(a, b, 8, 4), { x: 4, y: 2, w: 2, h: 1 });
  const c = new Canvas(16, 16); const g = c.getContext("2d"); g.fillStyle = "#336699"; g.fillRect(0, 0, 16, 16);
  const { data } = imageChunks(await c.encode("webp", 80));
  const buf = muxAnimation(16, 16, [{ x: 0, y: 0, w: 16, h: 16, duration: 100, data, alpha: false }, { x: 2, y: 2, w: 16 - 2, h: 16 - 2, duration: 50, data, alpha: false }].slice(0, 1));
  assert.equal(buf.toString("latin1", 0, 4), "RIFF");
  assert.equal(buf.readUInt32LE(4) + 8, buf.length);
  assert.equal(buf.toString("latin1", 12, 16), "VP8X");
  assert.ok(buf.includes(Buffer.from("ANMF")));
});

test("wrapLine soft-wraps long lines with a hanging indent and loses no characters", async () => {
  const { wrapLine } = await import("../dist/render.js");
  const text = "    const result = await someVeryLongFunctionName(firstArgument, secondArgument, thirdArgument);";
  const segs = wrapLine(text, 40);
  assert.ok(segs.length > 1);
  assert.equal(segs[0].indent, 0);
  assert.ok(segs.slice(1).every((s) => s.indent === 6));
  for (const s of segs) assert.ok(s.e - s.s + s.indent <= 40);
  const joined = segs.map((s) => text.slice(s.s, s.e)).join("").replace(/\s+/g, "");
  assert.equal(joined, text.replace(/\s+/g, ""));
  assert.equal(wrapLine("short", 40).length, 1);
});

test("lineValue prefers code over comments, strings and help text", async () => {
  const { lineValue } = await import("../dist/pick.js");
  const code = lineValue("  const total = items.reduce((a, b) => a + b, 0);");
  assert.equal(code, 1);
  assert.ok(lineValue("  // explain what happens next in plain words") < 0.5);
  assert.ok(lineValue('  "Output path without extension (default: prcine)",') < 0.5);
  assert.ok(lineValue("      --size <px>         Short side in pixels") < 0.5);
  assert.equal(lineValue("#[cfg(unix)]"), 1);
});

test("pickHighlights prefers core source over tests and help strings", async () => {
  const mk = (path, lines) => ({ path, status: "modified", additions: lines.length, deletions: 0, binary: false,
    hunks: [{ oldStart: 1, newStart: 1, header: "", lines: lines.map((text, i) => ({ kind: "add", text, newNo: i + 1 })) }] });
  const test = mk("src/__tests__/app.test.ts", Array.from({ length: 12 }, (_, i) => `expect(add(${i}, 1)).toBe(${i + 1});`));
  const help = mk("src/cli.ts", Array.from({ length: 12 }, (_, i) => `  --flag-${i}         Does a thing with the option number ${i}`));
  const core = mk("src/core/add.ts", ["export function add(a: number, b: number) {", "  if (!Number.isFinite(a)) throw new TypeError('a');", "  return a + b;", "}"]);
  const cs = { repo: "x/y", title: "t", commits: 1, additions: 28, deletions: 0, files: [test, help, core] };
  assert.equal(pickHighlights(cs, 1, 13)[0].file.path, "src/core/add.ts");
  const picked = pickHighlights(cs, 3, 13);
  assert.ok(!picked.some((h) => h.file === test), "test file should not be filler");
});
