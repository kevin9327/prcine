import type { DiffLine, FileDiff, Hunk } from "./types.js";

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/** Parse the hunk body of a single file patch (GitHub API `patch` field or git diff body). */
export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split("\n")) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      o = Number(m[1]);
      n = Number(m[2]);
      cur = { oldStart: o, newStart: n, header: m[3] ?? "", lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const c = raw[0];
    const text = raw.slice(1).replace(/\r$/, "");
    let line: DiffLine;
    if (c === "+") line = { kind: "add", text, newNo: n++ };
    else if (c === "-") line = { kind: "del", text, oldNo: o++ };
    else if (c === " " || raw === "") line = { kind: "ctx", text, oldNo: o++, newNo: n++ };
    else continue;
    cur.lines.push(line);
  }
  // drop a trailing empty ctx line produced by a final newline
  for (const h of hunks) {
    const last = h.lines[h.lines.length - 1];
    if (last && last.kind === "ctx" && last.text === "" && h === hunks[hunks.length - 1]) h.lines.pop();
  }
  return hunks;
}

/** Parse full `git diff` output into files. */
export function parseGitDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const chunks = diff.split(/^diff --git /m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const head = lines[0];
    const hm = /^a\/(.+?) b\/(.+)$/.exec(head);
    let oldPath = hm?.[1];
    let path = hm?.[2] ?? head;
    let status: FileDiff["status"] = "modified";
    let binary = false;
    let bodyStart = lines.length;
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("new file mode")) status = "added";
      else if (l.startsWith("deleted file mode")) status = "deleted";
      else if (l.startsWith("rename from ")) { oldPath = l.slice(12); status = "renamed"; }
      else if (l.startsWith("rename to ")) path = l.slice(10);
      else if (l.startsWith("Binary files")) binary = true;
      else if (l.startsWith("+++ ")) { const p = l.slice(4); if (p !== "/dev/null") path = p.replace(/^b\//, ""); }
      else if (l.startsWith("@@")) { bodyStart = i; break; }
    }
    const hunks = parseHunks(lines.slice(bodyStart).join("\n"));
    let additions = 0, deletions = 0;
    for (const h of hunks) for (const l of h.lines) { if (l.kind === "add") additions++; else if (l.kind === "del") deletions++; }
    files.push({ path, oldPath: oldPath !== path ? oldPath : undefined, status, additions, deletions, binary, hunks });
  }
  return files;
}
