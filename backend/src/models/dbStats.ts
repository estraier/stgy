export type QueryStats = {
  query: string;
  calls: number;
  totalExecTime: number;
};

export type QueryStatsPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export type ListSlowQueriesInput = QueryStatsPagination;
