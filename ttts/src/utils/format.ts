import { Tokenizer } from "./tokenizer";

export async function makeFtsQuery(query: string, locale: string, maxTokens: number): Promise<string> {
  const tokenizer = await Tokenizer.getInstance();
  const effectiveLocale = tokenizer.guessLocale(query, locale);
  const parts: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  let totalTokens = 0;
  while ((match = regex.exec(query)) !== null && totalTokens < maxTokens) {
    if (match[1]) {
      const tokens = tokenizer.tokenize(match[1], effectiveLocale).map(t => t.trim()).filter(t => t.length > 0).slice(0, maxTokens - totalTokens);
      totalTokens += tokens.length;
      if (tokens.length > 0) parts.push(tokens.join(" "));
    } else if (match[2]) {
      const tokens = tokenizer.tokenize(match[2], effectiveLocale).map(t => t.trim()).filter(t => t.length > 0).slice(0, maxTokens - totalTokens);
      totalTokens += tokens.length;
      if (tokens.length > 0) parts.push(tokens.join(" AND "));
    }
  }
  return parts.join(" AND ");
}
