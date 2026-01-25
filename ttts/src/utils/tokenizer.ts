import kuromoji from "kuromoji";
import path from "path";
import { Config } from "../config";

export class Tokenizer {
  private kTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

  private constructor() {}

  public static async create(): Promise<Tokenizer> {
    const instance = new Tokenizer();
    if (Config.ENABLE_KUROMOJI) {
      await instance.initKuromoji();
    }
    return instance;
  }

  private initKuromoji(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 辞書のパス。node_modules内の場所を指定。
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
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ") // 制御文字を空白に置換
      .trim();
  }

  public guessLocale(text: string, preferableLocale: string = "en"): string {
    const normalized = this.normalize(text);
    if (!normalized) return preferableLocale;

    const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
    const hasHangul = /\p{Script=Hangul}/u.test(normalized);
    const hasHan = /\p{Script=Han}/u.test(normalized);

    if (hasKana) return "ja";
    if (hasHangul) return "ko";

    if (hasHan) {
      // 漢字があり、指定が中国語系なら中国語、そうでなければ日本語（ja）として扱う
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

    // 日本語かつ Kuromoji が有効な場合
    if (locale.startsWith("ja") && this.kTokenizer) {
      const results = this.kTokenizer.tokenize(normalized);
      rawTokens = results.map((t) => t.surface_form);
    } else {
      // それ以外、または Kuromoji 無効時は標準の Intl.Segmenter を使用
      // Intl.Segmenter は OS/Node.js 標準機能のため追加メモリ消費が少ない
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const segments = segmenter.segment(normalized);
      rawTokens = Array.from(segments)
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);
    }

    const tokens: string[] = [];
    const symbolOnlyRegex = /^[\p{P}\p{S}]+$/u; // 記号のみの判定

    for (const token of rawTokens) {
      // ダイアクリティック（アクセント記号等）を除去
      const cleanToken = token
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC");

      if (!cleanToken) continue;

      // 記号のみからなる単語はインデックスから除外
      if (symbolOnlyRegex.test(cleanToken)) {
        continue;
      }

      tokens.push(cleanToken);
    }

    return tokens;
  }
}
