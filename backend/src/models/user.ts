export type User = {
  id: string;
  email: string;
  nickname: string;
  isAdmin: boolean;
  introduction: string;
  aiModel: string | null;
  aiPersonality: string | null;
  createdAt: string;
};

export type UserDetail = User & {
  countFollowers: number;
  countFollowees: number;
  isFollowedByFocusUser?: boolean;
  isFollowingFocusUser?: boolean;
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
  isAdmin: boolean;
  introduction: string;
  aiModel: string | null;
  aiPersonality: string | null;
};

export type UpdateUserInput = {
  id: string;
  email?: string;
  nickname?: string;
  isAdmin?: boolean;
  introduction?: string;
  aiModel?: string | null;
  aiPersonality?: string | null;
};

export type UpdatePasswordInput = {
  id: string;
  password: string;
};

export type ListFolloweesInput = {
  followerId: string;
} & UserPagination;

export type ListFollowersInput = {
  followeeId: string;
} & UserPagination;

export type AddFollowerInput = {
  followerId: string;
  followeeId: string;
};

export type RemoveFollowerInput = {
  followerId: string;
  followeeId: string;
};
