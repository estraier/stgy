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
