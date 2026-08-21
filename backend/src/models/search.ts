export type Document = {
  id: string;
  timestamp: number;
  bodyText: string;
  locale: string;
  labels: string[];
  numericValue: number | null;
};

export type SearchNumericOp = "eq" | "gt" | "gte" | "lt" | "lte";

export type SearchResult<T> = {
  tokens: string[];
  phrases: string[];
  result: T[];
};

export type SearchInput = {
  query: string;
  locale: string;
  offset?: number;
  limit?: number;
  timeout?: number;
  labels?: string[];
  numericOp?: SearchNumericOp;
  numericValue?: number;
};

export type SearchCacheEntry = {
  query: string;
  limit: number;
  tokens: string[];
  phrases: string[];
  result: string[];
};
