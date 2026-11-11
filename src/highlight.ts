import { createHighlighter, bundledLanguagesInfo, type Highlighter } from "shiki";

export interface Tok { text: string; color: string }

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", rb: "ruby", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cxx: "cpp", cs: "csharp", php: "php", scala: "scala",
  sh: "bash", bash: "bash", zsh: "bash", fish: "fish", ps1: "powershell", lua: "lua", dart: "dart", zig: "zig",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", ml: "ocaml", clj: "clojure", r: "r", jl: "julia",
  vue: "vue", svelte: "svelte", astro: "astro", html: "html", css: "css", scss: "scss", less: "less",
  json: "json", jsonc: "jsonc", yml: "yaml", yaml: "yaml", toml: "toml", md: "markdown", mdx: "mdx",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto", tf: "hcl", hcl: "hcl", nix: "nix",
  xml: "xml", dockerfile: "docker", makefile: "makefile", cmake: "cmake", gradle: "groovy", m: "objective-c",
};

export function langFor(path: string): string {
  const base = path.split("/").pop()!.toLowerCase();
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  const l = EXT[ext];
  if (l && bundledLanguagesInfo.some((i) => i.id === l || i.aliases?.includes(l))) return l;
  return "text";
}

export const THEME = "vitesse-dark";
let hl: Promise<Highlighter> | null = null;

export async function tokenize(code: string, lang: string, fallback: string): Promise<Tok[][]> {
  hl ??= createHighlighter({ themes: [THEME], langs: [] });
  const h = await hl;
  if (lang !== "text" && !h.getLoadedLanguages().includes(lang)) {
    try { await h.loadLanguage(lang as any); } catch { lang = "text"; }
  }
  if (lang === "text") return code.split("\n").map((t) => [{ text: t, color: fallback }]);
  const res = h.codeToTokens(code, { lang: lang as any, theme: THEME });
  return res.tokens.map((line) => line.map((t) => ({ text: t.content, color: t.color ?? fallback })));
}
