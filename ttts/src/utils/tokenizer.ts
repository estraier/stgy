import kuromoji from "kuromoji";
import path from "path";

export class Tokenizer {
  private kTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

  private constructor() {}

  public static async create(): Promise<Tokenizer> {
    const instance = new Tokenizer();
    await instance.init();
    return instance;
  }

  private init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dicPath = path.resolve(process.cwd(), "node_modules/kuromoji/dict");

      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) {
          reject(err);
          return;
        }
        this.kTokenizer = tokenizer;
        resolve();
      });
    });
  }

  private normalize(text: string): string {
    return text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .trim();
  }

  public guessLocale(text: string, preferableLocale: string = "en"): string {
    const normalized = this.normalize(text);
    if (!normalized) return preferableLocale;

    const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
    const hasHangul = /\p{Script=Hangul}/u.test(normalized);
    const hasHan = /\p{Script=Han}/u.test(normalized);

    if (hasKana) {
      return "ja";
    }

    if (hasHangul) {
      return "ko";
    }

    if (hasHan) {
      if (preferableLocale.startsWith("zh")) {
        return "zh";
      }
      return "ja";
    }

    return preferableLocale;
  }

  public tokenize(text: string, locale: string): string[] {
    const normalized = this.normalize(text);
    if (!normalized) return [];

    let rawTokens: string[] = [];

    if (locale === "ja" || locale.startsWith("ja")) {
      if (!this.kTokenizer) {
        throw new Error("Tokenizer is not initialized. Call Tokenizer.create() first.");
      }
      const results = this.kTokenizer.tokenize(normalized);
      rawTokens = results.map((t) => t.surface_form);
    } else {
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const segments = segmenter.segment(normalized);
      rawTokens = Array.from(segments)
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);
    }

    const tokens: string[] = [];
    const symbolOnlyRegex = /^[\p{P}\p{S}]+$/u;

    for (const token of rawTokens) {
      const cleanToken = token
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC");

      if (!cleanToken) continue;

      if (symbolOnlyRegex.test(cleanToken)) {
        continue;
      }

      tokens.push(cleanToken);
    }

    return tokens;
  }
}
