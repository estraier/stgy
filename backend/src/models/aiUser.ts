import type { AIModelTier } from "./aiModel";

export type AiUser = {
  id: string;
  nickname: string;
  isAdmin: boolean;
  aiModel: AIModelTier | null;
};

export type AiUserDetail = AiUser & {
  email: string;
  createdAt: string;
  updatedAt: string | null;
  introduction: string;
  aiPersonality: string;
};

export type AiUserPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export type ListAiUsersInput = AiUserPagination & {
  after?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  model?: AIModelTier;
  messages: ChatMessage[];
  responseFormat?: "text" | "json";
};

export type ChatResponse = {
  message: {
    content: string;
  };
};

export type GenerateFeaturesRequest = {
  input: string;
};

export type GenerateFeaturesResponse = {
  features: Int8Array;
};

export type AiUserInterest = {
  userId: string;
  updatedAt: string;
  interest: string;
  features: Int8Array;
  tags: string[];
};

export type AiUserInterestPacket = {
  userId: string;
  updatedAt: string;
  interest: string;
  features: string;
  tags: string[];
};

export type SetAiUserInterestInput = {
  userId: string;
  interest: string;
  features: Int8Array;
  tags: string[];
};

export type SetAiUserInterestInputPacket = {
  userId: string;
  interest: string;
  features: string;
  tags: string[];
};

export type AiPeerImpression = {
  userId: string;
  peerId: string;
  updatedAt: string;
  payload: string;
  peerNickname?: string | null;
};

export type AiPeerImpressionFilter = {
  userId?: string;
  peerId?: string;
};

export type ListAiPeerImpressionsInput = AiPeerImpressionFilter & AiUserPagination;

export type SetAiPeerImpressionInput = {
  userId: string;
  peerId: string;
  payload: string;
};

export type AiPostImpression = {
  userId: string;
  peerId: string;
  postId: string;
  updatedAt: string;
  payload: string;
  peerNickname?: string | null;
  postSnippet?: string | null;
};

export type AiPostImpressionFilter = {
  userId?: string;
  peerId?: string;
  postId?: string;
};

export type ListAiPostImpressionsInput = AiPostImpressionFilter & AiUserPagination;

export type SetAiPostImpressionInput = {
  userId: string;
  postId: string;
  payload: string;
};
