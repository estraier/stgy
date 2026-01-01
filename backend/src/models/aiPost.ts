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
  updatedAt: string;
  summary: string | null;
  features: Int8Array | null;
  tags: string[];
};

export type AiPostSummaryPacket = {
  postId: string;
  updatedAt: string;
  summary: string | null;
  features: string | null;
  tags: string[];
};

export type UpdateAiPostSummaryInput = {
  postId: string;
  summary?: string | null;
  features?: Int8Array | null;
  tags?: string[];
};

export type UpdateAiPostSummaryPacket = {
  postId: string;
  summary?: string | null;
  features?: string | null;
  tags?: string[];
};

export type SearchSeedTag = {
  name: string;
  count: number;
};

export type SearchSeed = {
  tags: SearchSeedTag[];
  features: Int8Array;
  weight: number;
  postIds: string[];
};

export type SearchSeedPacket = {
  tags: SearchSeedTag[];
  features: string;
  weight: number;
  postIds: string[];
};

export type RecommendPostsInput = {
  tags: SearchSeedTag[];
  features?: Int8Array;
  seedPostIds?: string[];
  selfUserId?: string;
  rerankByLikesAlpha?: number;
  dedupWeight?: number;
} & AiPostPagination;

export type RecommendPostsInputPacket = {
  tags: SearchSeedTag[];
  features?: string | null;
  seedPostIds?: string[];
  selfUserId?: string;
  rerankByLikesAlpha?: number;
  dedupWeight?: number;
} & AiPostPagination;
