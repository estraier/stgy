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

export type UserFilter = {
  query?: string;
  nickname?: string;
};

export type UserPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc" | "social";
};

export type CountUsersInput = UserFilter;

export type ListUsersInput = UserFilter & UserPagination;

export type CreateUserInput = {
  email: string;
  nickname: string;
  password: string;
  is_admin: boolean;
  introduction: string;
  personality: string;
  model: string;
};

export type UpdateUserInput = {
  id: string;
  email?: string;
  nickname?: string;
  is_admin?: boolean;
  introduction?: string;
  personality?: string;
  model?: string;
};

export type UpdatePasswordInput = {
  id: string;
  password: string;
};

export type ListFolloweesInput = {
  follower_id: string;
} & UserPagination;

export type ListFollowersInput = {
  followee_id: string;
} & UserPagination;

export type AddFollowerInput = {
  follower_id: string;
  followee_id: string;
};

export type RemoveFollowerInput = {
  follower_id: string;
  followee_id: string;
};
