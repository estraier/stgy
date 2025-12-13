export type AiPostPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export type AiPostSummaryFilter = {
  nullOnly?: boolean;
  newerThan?: string;
};

export type ListAiPostSummariesInput = AiPostSummaryFilter & AiPostPagination;

export type AiPostSummary = {
  postId: string;
  summary: string | null;
  features: Int8Array | null;
  tags: string[];
};

export type UpdateAiPostSummaryInput = {
  postId: string;
  summary?: string | null;
  features?: Int8Array | null;
  tags?: string[];
};
