export type QueryStats = {
  id: string;
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
