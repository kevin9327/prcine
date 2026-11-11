export type LineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: Hunk[];
}

export interface ChangeSet {
  repo: string; // owner/name or folder name
  title: string;
  number?: number;
  author?: string;
  state?: string; // merged | open | closed | range
  ref?: string; // e.g. main...HEAD
  commits: number;
  additions: number;
  deletions: number;
  files: FileDiff[];
  url?: string;
}
