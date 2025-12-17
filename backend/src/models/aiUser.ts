export type AiUser = {
  id: string;
  nickname: string;
  isAdmin: boolean;
  aiModel: string | null;
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

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  model?: string;
  messages: ChatMessage[];
};

export type ChatResponse = {
  message: {
    content: string;
  };
};

export type GenerateFeaturesRequest = {
  model?: string;
  input: string;
};

export type GenerateFeaturesResponse = {
  features: Int8Array;
};

export type AiUserInterest = {
  userId: string;
  interest: string;
  features: Int8Array;
  tags: string[];
};

export type AiUserInterestPacket = {
  userId: string;
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
  payload: string;
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
  payload: string;
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
