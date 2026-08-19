export type ParsedPostSearchQuery = {
  query: string;
  owners: string[];
  publishedOnly: boolean;
};

export function parsePostSearchQuery(input: string): ParsedPostSearchQuery {
  const tokens = input.match(/"[^"]*"|\S+/g) ?? [];
  const queryParts: string[] = [];
  const owners: string[] = [];
  let publishedOnly = false;

  for (const token of tokens) {
    if (token.startsWith('"') && token.endsWith('"')) {
      queryParts.push(token);
      continue;
    }
    if (token.startsWith("owner:")) {
      const owner = token.slice("owner:".length);
      if (!owner) throw new Error("owner filter requires a user ID");
      owners.push(owner);
      continue;
    }
    if (token.startsWith("status:")) {
      const status = token.slice("status:".length);
      if (status !== "published") throw new Error("invalid status filter");
      publishedOnly = true;
      continue;
    }
    queryParts.push(token);
  }

  return {
    query: queryParts.join(" "),
    owners,
    publishedOnly,
  };
}
