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

export type UserDetail = User & {
  count_followers: number;
  count_followees: number;
  is_followed_by_focus_user?: boolean;
  is_following_focus_user?: boolean;
};

export type Post = {
  id: string;
  content: string;
  owned_by: string;
  reply_to: string | null;
  created_at: string;
};

export type PostDetail = Post & {
  owner_nickname: string;
  reply_to_owner_nickname: string | null;
  reply_count: number;
  like_count: number;
  tags: string[];
  is_liked_by_focus_user?: boolean;
  is_replied_by_focus_user?: boolean;
};
