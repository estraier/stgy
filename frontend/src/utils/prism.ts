let prismPromise: Promise<any> | null = null;

export async function getPrism() {
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

const DEPENDS: Record<string, string[]> = {
  cpp: ["c"],
  c: ["clike"],
  javascript: ["clike"],
  typescript: ["javascript"],
  jsx: ["markup", "javascript"],
  tsx: ["jsx", "typescript"],
  graphql: ["markup"],
};

const LOADERS: Record<string, () => Promise<any>> = {
  markup: () => import("prismjs/components/prism-markup"),
  css: () => import("prismjs/components/prism-css"),
  clike: () => import("prismjs/components/prism-clike"),
  javascript: () => import("prismjs/components/prism-javascript"),
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: () => import("prismjs/components/prism-tsx"),
  json: () => import("prismjs/components/prism-json"),
  yaml: () => import("prismjs/components/prism-yaml"),
  bash: () => import("prismjs/components/prism-bash"),
  sql: () => import("prismjs/components/prism-sql"),
  python: () => import("prismjs/components/prism-python"),
  rust: () => import("prismjs/components/prism-rust"),
  go: () => import("prismjs/components/prism-go"),
  java: () => import("prismjs/components/prism-java"),
  c: () => import("prismjs/components/prism-c"),
  cpp: () => import("prismjs/components/prism-cpp"),
  diff: () => import("prismjs/components/prism-diff"),
  docker: () => import("prismjs/components/prism-docker"),
  makefile: () => import("prismjs/components/prism-makefile"),
  graphql: () => import("prismjs/components/prism-graphql"),
  http: () => import("prismjs/components/prism-http"),
  ini: () => import("prismjs/components/prism-ini"),
  toml: () => import("prismjs/components/prism-toml"),
  markdown: () => import("prismjs/components/prism-markdown"),
};

export function resolveHighlightLang(raw?: string | null): string | null {
  const lang = mapLang(raw);
  if (!lang) return null;
  if (!LOADERS[lang]) return null;
  return lang;
}

async function loadWithDeps(lang: string, seen = new Set<string>()) {
  if (seen.has(lang)) return;
  seen.add(lang);
  const deps = DEPENDS[lang] || [];
  for (const d of deps) {
    await loadWithDeps(d, seen);
  }
  const loader = LOADERS[lang];
  if (loader) {
    try {
      await loader();
    } catch {
    }
  }
}

export async function ensureLanguage(lang: string) {
  const Prism = await getPrism();
  await loadWithDeps(lang);
  return { Prism, lang };
}
