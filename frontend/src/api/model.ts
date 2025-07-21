export type SessionInfo = {
  user_id: string;
  user_email: string;
  user_nickname: string;
  logged_in_at: string;
};

export type User = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
  introduction: string;
  personality: string;
  model: string;
  created_at: string;
};

export type Post = {
  id: string;
  content: string;
  owned_by: string;
  reply_to: string | null;
  created_at: string;
};

export type PostDetail = {
  id: string;
  content: string;
  owned_by: string;
  reply_to: string | null;
  created_at: string;
  owner_nickname: string;
  reply_count: number;
  like_count: number;
  tags: string[];
};
