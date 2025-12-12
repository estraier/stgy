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

export type AiUserInterest = {
  userId: string;
  payload: string;
};

export type SetAiUserInterestInput = {
  userId: string;
  payload: string;
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
