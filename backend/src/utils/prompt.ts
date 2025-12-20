import fs from "fs";
import path from "path";

function normalizeLocale(locale: string | undefined | null): string {
  return (locale || "").replace("_", "-");
}

function getCandidates(prefix: string, locale: string, defaultLocale: string): string[] {
  const loc = normalizeLocale(locale);
  const def = normalizeLocale(defaultLocale);
  const candidates: string[] = [];
  if (loc) {
    candidates.push(`${prefix}-${loc}.txt`);
    const lang = loc.split("-")[0];
    if (lang && lang !== loc) {
      candidates.push(`${prefix}-${lang}.txt`);
    }
  }
  if (def) {
    const defFull = `${prefix}-${def}.txt`;
    if (!candidates.includes(defFull)) {
      candidates.push(defFull);
    }
    const defLang = def.split("-")[0];
    const defLangFile = `${prefix}-${defLang}.txt`;
    if (defLang && !candidates.includes(defLangFile)) {
      candidates.push(defLangFile);
    }
  }
  return candidates;
}

export function readPrompt(prefix: string, locale: string, defaultLocale = "en"): string {
  const promptsDir = path.resolve(__dirname, "..", "prompts");
  const candidates = getCandidates(prefix, locale, defaultLocale);
  for (const filename of candidates) {
    const fullPath = path.join(promptsDir, filename);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf8");
    }
  }
  throw new Error(
    `prompt file not found for prefix=${prefix}, locale=${locale}, defaultLocale=${defaultLocale}`,
  );
}

export function evaluateChatResponseAsJson<T = unknown>(raw: string): T {
  let s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    s = fenced[1].trim();
  } else {
    const firstBrace = s.indexOf("{");
    const lastBrace = s.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
  }
  if (/,\s*[}\]]\s*$/.test(s)) {
    s = s.replace(/,\s*([}\]])\s*$/u, "$1");
  }
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    const fixed = s
      .split("\n")
      .map((line) => {
        return line.replace(
          /^(\s*"[^"]+"\s*:\s*")(.+)("\s*,?\s*)$/,
          (_, prefix, content, suffix) => {
            return prefix + content.replace(/(?<!\\)"/g, '\\"') + suffix;
          },
        );
      })
      .join("\n");
    try {
      return JSON.parse(fixed) as T;
    } catch {
      throw e;
    }
  }
}
