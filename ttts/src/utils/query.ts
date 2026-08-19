import { Tokenizer } from "./tokenizer";

export function quoteFtsText(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function formatFtsToken(token: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(token) ? token : quoteFtsText(token);
}

export async function makeFtsQuery(
  query: string,
  locale: string,
  maxTokens: number,
  supportPhrase: boolean = false,
): Promise<{ ftsQuery: string; filteringPhrases: string[] }> {
  const tokenizer = await Tokenizer.getInstance();
  const effectiveLocale = tokenizer.guessLocale(query, locale);

  const parts: string[] = [];
  const filteringPhrases: string[] = [];

  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  let totalTokens = 0;

  while ((match = regex.exec(query)) !== null && totalTokens < maxTokens) {
    if (match[1]) {
      const text = match[1];
      const tokens = tokenizer
        .tokenize(text, effectiveLocale)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, maxTokens - totalTokens);

      totalTokens += tokens.length;

      if (tokens.length > 0) {
        if (supportPhrase) {
          parts.push(tokens.map(formatFtsToken).join(" + "));
        } else {
          parts.push(tokens.map(formatFtsToken).join(" AND "));
          if (tokens.length > 1) {
            filteringPhrases.push(tokens.join("\n"));
          }
        }
      }
    } else if (match[2]) {
      const text = match[2];
      const tokens = tokenizer
        .tokenize(text, effectiveLocale)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, maxTokens - totalTokens);

      totalTokens += tokens.length;

      if (tokens.length > 0) {
        parts.push(tokens.map(formatFtsToken).join(" AND "));
      }
    }
  }

  return {
    ftsQuery: parts.join(" AND "),
    filteringPhrases,
  };
}
