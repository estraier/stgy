import { Tokenizer } from "./tokenizer";

export function quoteFtsText(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function formatFtsToken(token: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(token) ? token : quoteFtsText(token);
}

function makePhraseText(text: string, tokens: string[], truncated: boolean): string {
  if (!truncated) return text.trim();
  return tokens.join(/\s/u.test(text) ? " " : "");
}

export async function makeFtsQuery(
  query: string,
  locale: string,
  maxTokens: number,
  recordPositions: boolean = false,
  recordContents: boolean = true,
): Promise<{
  ftsQuery: string;
  filteringPhrases: string[];
  tokens: string[];
  phrases: string[];
}> {
  const tokenizer = await Tokenizer.getInstance();
  const effectiveLocale = tokenizer.guessLocale(query, locale);

  const parts: string[] = [];
  const filteringPhrases: string[] = [];
  const searchTokens: string[] = [];
  const searchPhrases: string[] = [];

  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  let totalTokens = 0;

  while ((match = regex.exec(query)) !== null && totalTokens < maxTokens) {
    const text = match[1] ?? match[2]!;
    const allTokens = tokenizer
      .tokenize(text, effectiveLocale)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const tokens = allTokens.slice(0, maxTokens - totalTokens);
    const truncated = tokens.length < allTokens.length;

    totalTokens += tokens.length;
    searchTokens.push(...tokens);

    if (tokens.length === 0) continue;

    const isQuoted = match[1] !== undefined;
    const isPhrase =
      tokens.length > 1 && (recordPositions || (isQuoted && recordContents));

    if (isPhrase) {
      searchPhrases.push(makePhraseText(text, tokens, truncated));
    } else {
      searchPhrases.push(...tokens);
    }

    if (isQuoted) {
      if (recordPositions) {
        parts.push(tokens.map(formatFtsToken).join(" + "));
      } else {
        parts.push(tokens.map(formatFtsToken).join(" AND "));
        if (recordContents && tokens.length > 1) {
          filteringPhrases.push(tokens.join("\n"));
        }
      }
    } else if (recordPositions && tokens.length > 1) {
      parts.push(tokens.map(formatFtsToken).join(" + "));
    } else {
      parts.push(tokens.map(formatFtsToken).join(" AND "));
    }
  }

  return {
    ftsQuery: parts.join(" AND "),
    filteringPhrases,
    tokens: searchTokens,
    phrases: searchPhrases,
  };
}
