export const C = {
  bg: "#07080B",
  panel: "#0E1014",
  panel2: "#12151B",
  border: "rgba(255,255,255,0.08)",
  text: "#ECEDF0",
  sub: "#A2A6B1",
  dim: "#5E636F",
  faint: "#2A2E37",
  accent: "#8EA2FF",
  add: "#3FE0A0",
  del: "#FF6A86",
  merged: "#B48CFF",
  open: "#3FE0A0",
  closed: "#FF6A86",
};

export const SANS = "Geist";
export const MONO = "Geist Mono";

export const ease = {
  out3: (t: number) => 1 - Math.pow(1 - clamp01(t), 3),
  out5: (t: number) => 1 - Math.pow(1 - clamp01(t), 5),
  inOut3: (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  in2: (t: number) => clamp01(t) ** 2,
  back: (t: number) => { t = clamp01(t); const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

export function clamp01(t: number) { return t < 0 ? 0 : t > 1 ? 1 : t; }
export function prog(t: number, start: number, dur: number) { return clamp01((t - start) / dur); }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function fmt(n: number) { return Math.round(n).toLocaleString("en-US"); }

export function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Colors for common languages, used for the small file dot. */
export const LANG_COLOR: Record<string, string> = {
  typescript: "#3178C6", tsx: "#3178C6", javascript: "#F1E05A", jsx: "#F1E05A", python: "#3572A5", rust: "#DEA584",
  go: "#00ADD8", ruby: "#CC342D", java: "#B07219", kotlin: "#A97BFF", swift: "#F05138", c: "#8E9BB0", cpp: "#F34B7D",
  csharp: "#178600", php: "#4F5D95", bash: "#89E051", lua: "#5B7BD5", dart: "#00B4AB", zig: "#EC915C", elixir: "#9C7CC4",
  haskell: "#5E5086", vue: "#41B883", svelte: "#FF3E00", html: "#E34C26", css: "#663399", scss: "#C6538C",
  json: "#CBCB41", yaml: "#CB171E", toml: "#9C4221", markdown: "#6B8AFF", sql: "#E38C00", text: "#8A8F9A",
};

/** Pluralize a count: "1 file", "3 files". */
export function plural(n: number, word: string) {
  return `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
}
