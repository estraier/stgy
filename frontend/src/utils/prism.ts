// src/utils/prism.ts
type PrismNS = typeof import("prismjs");

let prismPromise: Promise<PrismNS> | null = null;

export async function getPrism(): Promise<PrismNS> {
  if (!prismPromise) {
    prismPromise = import("prismjs");
  }
  return prismPromise;
}

const ALIASES: Record<string, string> = {
  html: "markup",
  xml: "markup",
  svg: "markup",
  mathml: "markup",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  cplusplus: "cpp",
};

export function mapLang(raw?: string | null): string {
  const k = (raw || "").trim().toLowerCase();
  return ALIASES[k] || k;
}

const SUPPORTED = new Set<string>([
  "markup",
  "css",
  "clike",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "yaml",
  "bash",
  "sql",
  "python",
  "ruby",
  "rust",
  "go",
  "lua",
  "perl",
  "java",
  "c",
  "cpp",
  "diff",
  "docker",
  "makefile",
  "graphql",
  "http",
  "ini",
  "toml",
  "markdown",
]);

export function resolveHighlightLang(raw?: string | null): string | null {
  const lang = mapLang(raw);
  if (!lang) return null;
  if (!SUPPORTED.has(lang)) return null;
  return lang;
}

export async function ensureLanguage(lang: string): Promise<{ Prism: PrismNS; lang: string }> {
  const Prism = await getPrism();
  const { default: loadLanguages } = await import("prismjs/components/");
  loadLanguages([lang]);
  return { Prism, lang };
}
