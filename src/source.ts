import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { parseGitDiff, parseHunks } from "./diff.js";
import type { ChangeSet, FileDiff } from "./types.js";

export interface PrRef { owner: string; repo: string; number: number }

export function parsePrRef(input: string): PrRef | null {
  const url = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(input);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(input);
  if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) };
  return null;
}

function hasGh(): boolean {
  try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); return true; } catch { return false; }
}

async function getJson(path: string, useGh: boolean): Promise<any> {
  if (useGh) {
    const out = execFileSync("gh", ["api", path], { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" });
    return JSON.parse(out);
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "prcine",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}${res.status === 403 ? " (rate limited? set GITHUB_TOKEN)" : ""}`);
  return res.json();
}

export async function loadPr(ref: PrRef): Promise<ChangeSet> {
  const useGh = hasGh();
  const base = `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const pr = await getJson(base, useGh);
  const files: FileDiff[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch: any[] = await getJson(`${base}/files?per_page=100&page=${page}`, useGh);
    for (const f of batch) {
      const hunks = f.patch ? parseHunks(f.patch) : [];
      files.push({
        path: f.filename,
        oldPath: f.previous_filename,
        status: f.status === "removed" ? "deleted" : f.status === "renamed" ? "renamed" : f.status === "added" ? "added" : "modified",
        additions: f.additions,
        deletions: f.deletions,
        binary: !f.patch && f.changes === 0,
        hunks,
      });
    }
    if (batch.length < 100) break;
  }
  return {
    repo: `${ref.owner}/${ref.repo}`,
    title: pr.title,
    number: ref.number,
    author: pr.user?.login,
    state: pr.merged_at ? "merged" : pr.state,
    commits: pr.commits ?? 1,
    additions: pr.additions ?? files.reduce((a, f) => a + f.additions, 0),
    deletions: pr.deletions ?? files.reduce((a, f) => a + f.deletions, 0),
    files,
    url: pr.html_url,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function loadRange(range: string, cwd = process.cwd()): ChangeSet {
  const isRange = range.includes("..");
  const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const diffArgs = ["diff", "--no-color", "--no-ext-diff", "-M", "--unified=3"];
  let diff: string;
  let countRange: string;
  if (isRange) {
    diff = git(cwd, [...diffArgs, range]);
    countRange = range.includes("...") ? range.replace("...", "..") : range;
  } else {
    // a single commit-ish means "the changes in that commit"
    try { diff = git(cwd, [...diffArgs, `${range}^`, range]); }
    catch { diff = git(cwd, [...diffArgs, EMPTY_TREE, range]); }
    countRange = `${range}^..${range}`;
  }
  const files = parseGitDiff(diff);
  let commits = 1;
  try { commits = Number(git(cwd, ["rev-list", "--count", countRange]).trim()) || 1; } catch { /* root commit */ }
  let title = "";
  let author = "";
  try {
    const tip = countRange.split("..")[1] || "HEAD";
    title = commits === 1 ? git(cwd, ["log", "-1", "--format=%s", tip]).trim() : git(cwd, ["rev-parse", "--abbrev-ref", tip]).trim();
    if (!title || title === "HEAD") title = git(cwd, ["log", "-1", "--format=%s", tip]).trim();
    author = git(cwd, ["log", "-1", "--format=%an", tip]).trim();
  } catch { /* ignore */ }
  let repo = basename(cwd);
  try {
    const remote = git(cwd, ["remote", "get-url", "origin"]).trim();
    const m = /[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
    if (m) repo = m[1];
  } catch { /* no remote */ }
  return {
    repo, title, author, state: "range", ref: range, commits,
    additions: files.reduce((a, f) => a + f.additions, 0),
    deletions: files.reduce((a, f) => a + f.deletions, 0),
    files,
  };
}

export async function loadChangeSet(input: string, cwd?: string): Promise<ChangeSet> {
  const pr = parsePrRef(input);
  return pr ? loadPr(pr) : loadRange(input, cwd);
}
