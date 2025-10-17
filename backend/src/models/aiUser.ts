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
