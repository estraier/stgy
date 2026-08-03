type PrismNS = typeof import("prismjs");
type LanguageLoader = () => Promise<unknown>;

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

const CORE_LANGUAGES = new Set(["markup", "css", "clike", "javascript"]);

const LANGUAGE_DEPENDENCIES: Record<string, readonly string[]> = {
  typescript: ["javascript"],
  jsx: ["markup", "javascript"],
  tsx: ["jsx", "typescript"],
  ruby: ["clike"],
  go: ["clike"],
  java: ["clike"],
  c: ["clike"],
  cpp: ["c"],
  markdown: ["markup"],
};

const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: () => import("prismjs/components/prism-tsx"),
  json: () => import("prismjs/components/prism-json"),
  yaml: () => import("prismjs/components/prism-yaml"),
  bash: () => import("prismjs/components/prism-bash"),
  sql: () => import("prismjs/components/prism-sql"),
  python: () => import("prismjs/components/prism-python"),
  ruby: () => import("prismjs/components/prism-ruby"),
  rust: () => import("prismjs/components/prism-rust"),
  go: () => import("prismjs/components/prism-go"),
  lua: () => import("prismjs/components/prism-lua"),
  perl: () => import("prismjs/components/prism-perl"),
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

const SUPPORTED = new Set<string>([
  ...CORE_LANGUAGES,
  ...Object.keys(LANGUAGE_LOADERS),
]);

const languagePromises = new Map<string, Promise<void>>();

async function loadLanguage(lang: string): Promise<void> {
  if (CORE_LANGUAGES.has(lang)) return;

  const existing = languagePromises.get(lang);
  if (existing) {
    await existing;
    return;
  }

  const loader = LANGUAGE_LOADERS[lang];
  if (!loader) throw new Error(`unsupported Prism language: ${lang}`);

  const promise = (async () => {
    for (const dependency of LANGUAGE_DEPENDENCIES[lang] || []) {
      await loadLanguage(dependency);
    }
    await loader();
  })();

  languagePromises.set(lang, promise);
  try {
    await promise;
  } catch (error) {
    languagePromises.delete(lang);
    throw error;
  }
}

export function resolveHighlightLang(raw?: string | null): string | null {
  const lang = mapLang(raw);
  if (!lang) return null;
  if (!SUPPORTED.has(lang)) return null;
  return lang;
}

export async function ensureLanguage(lang: string): Promise<{ Prism: PrismNS; lang: string }> {
  const Prism = await getPrism();
  await loadLanguage(lang);
  return { Prism, lang };
}
