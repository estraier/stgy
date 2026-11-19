// Bound the number of candidates scanned across shards for public search requests.
// The SearchService itself is intentionally not capped: the volume-test CLI uses it
// to count large result sets without going through the HTTP API.
export const MAX_SEARCH_LIMIT = 2000;
export const MAX_SEARCH_OFFSET = 10000;
const DEFAULT_SEARCH_LIMIT = 100;

export class SearchPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchPaginationError";
  }
}

function parseBoundedInteger(value: unknown, name: string, min: number, max: number): number {
  // Express query parameters can also be arrays or objects. Require one complete
  // decimal integer: parseInt would accept e.g. "-1", "5garbage" or "1e9".
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new SearchPaginationError(`${name} must be an integer between ${min} and ${max}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new SearchPaginationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function parseSearchPagination(rawLimit: unknown, rawOffset: unknown): {
  limit: number;
  offset: number;
} {
  return {
    limit:
      rawLimit === undefined
        ? DEFAULT_SEARCH_LIMIT
        : parseBoundedInteger(rawLimit, "limit", 1, MAX_SEARCH_LIMIT),
    offset:
      rawOffset === undefined
        ? 0
        : parseBoundedInteger(rawOffset, "offset", 0, MAX_SEARCH_OFFSET),
  };
}
