import kuromoji from "kuromoji";
import path from "path";
import { Config } from "../config";

export class Tokenizer {
  private static instancePromise: Promise<Tokenizer> | null = null;
  private kTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
  private segmenterCache: Map<string, Intl.Segmenter> = new Map();

  private constructor() {}

  public static getInstance(): Promise<Tokenizer> {
    if (!this.instancePromise) {
      this.instancePromise = (async () => {
        const instance = new Tokenizer();
        if (Config.ENABLE_KUROMOJI) {
          await instance.initKuromoji();
        }
        return instance;
      })();
    }
    return this.instancePromise;
  }

  private initKuromoji(): Promise<void> {
    return new Promise((resolve, reject) => {
      let dicPath: string;
      try {
        const kuromojiEntry = require.resolve("kuromoji");
        dicPath = path.join(path.dirname(kuromojiEntry), "../dict") + path.sep;
      } catch (e) {
        dicPath = "node_modules/kuromoji/dict/";
      }

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
    const hasHan = /\p{Script=Han}/u.test(normalized);
    const hasHangul = /\p{Script=Hangul}/u.test(normalized);

    if (hasKana && preferableLocale.startsWith("ja")) {
      return "ja";
    }
    if (hasHan && preferableLocale.startsWith("zh")) {
      return "zh";
    }
    if (hasHangul && preferableLocale.startsWith("ko")) {
      return "ko";
    }
    if (hasKana || hasHan) {
      return "ja";
    }
    if (hasHangul) {
      return "ko";
    }
    return preferableLocale;
  }

  public tokenize(text: string, locale: string): string[] {
    const normalized = this.normalize(text);
    if (!normalized) return [];

    let rawTokens: string[] = [];

    if (locale.startsWith("ja") && this.kTokenizer) {
      const results = this.kTokenizer.tokenize(normalized);
      rawTokens = results.map((t) => t.surface_form);
    } else {
      let segmenter = this.segmenterCache.get(locale);
      if (!segmenter) {
        segmenter = new Intl.Segmenter(locale, { granularity: "word" });
        this.segmenterCache.set(locale, segmenter);
      }

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
