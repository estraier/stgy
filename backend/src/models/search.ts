export type Document = {
  id: string;
  timestamp: number;
  bodyText: string;
  locale: string;
};

export type SearchInput = {
  query: string;
  locale: string;
  offset?: number;
  limit?: number;
  timeout?: number;
};
