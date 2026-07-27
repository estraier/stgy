import kuromoji from "kuromoji";
import path from "path";
import { Config } from "../config";

const TECHNICAL_TERM_REGEX =
  /(?:\.[a-z0-9]+|[a-z0-9]+(?:\+\+|#)(?:[a-z0-9]+)?|[a-z0-9]+(?:[._][a-z0-9]+)+)/g;

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
      } catch {
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

  private cleanToken(token: string): string {
    return token
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .normalize("NFC");
  }

  private tokenizePlain(text: string, locale: string): string[] {
    if (!text.trim()) return [];

    let rawTokens: string[];
    if (locale.startsWith("ja") && this.kTokenizer) {
      rawTokens = this.kTokenizer.tokenize(text).map((t) => t.surface_form);
    } else {
      let segmenter = this.segmenterCache.get(locale);
      if (!segmenter) {
        segmenter = new Intl.Segmenter(locale, { granularity: "word" });
        this.segmenterCache.set(locale, segmenter);
      }
      rawTokens = Array.from(segmenter.segment(text))
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);
    }

    const symbolOnlyRegex = /^[\p{P}\p{S}]+$/u;
    const tokens: string[] = [];
    for (const token of rawTokens) {
      const cleanToken = this.cleanToken(token);
      if (!cleanToken || symbolOnlyRegex.test(cleanToken)) continue;
      tokens.push(cleanToken);
    }
    return tokens;
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

    const tokens: string[] = [];
    let offset = 0;
    for (const match of normalized.matchAll(TECHNICAL_TERM_REGEX)) {
      const index = match.index ?? 0;
      tokens.push(...this.tokenizePlain(normalized.slice(offset, index), locale));
      const technicalTerm = this.cleanToken(match[0]);
      if (technicalTerm) tokens.push(technicalTerm);
      offset = index + match[0].length;
    }
    tokens.push(...this.tokenizePlain(normalized.slice(offset), locale));
    return tokens;
  }
}
