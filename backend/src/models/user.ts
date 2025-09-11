export type User = {
  id: string;
  email: string;
  nickname: string;
  isAdmin: boolean;
  blockStrangers: boolean;
  snippet: string;
  avatar: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string | null;
  countFollowers: number;
  countFollowees: number;
  countPosts: number;
  isFollowedByFocusUser?: boolean;
  isFollowingFocusUser?: boolean;
  isBlockedByFocusUser?: boolean;
  isBlockingFocusUser?: boolean;
};

export type UserLite = Omit<
  User,
  "snippet" | "avatar" | "isFollowedByFocusUser" | "isFollowingFocusUser"
>;

export type UserDetail = User & {
  introduction: string;
  aiPersonality: string | null;
};

export type UserFilter = {
  query?: string;
  nickname?: string;
  nicknamePrefix?: string;
};

export type UserPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc" | "social";
};

export type CountUsersInput = UserFilter;

export type ListUsersInput = UserFilter & UserPagination;

export type CreateUserInput = {
  id?: string;
  email: string;
  nickname: string;
  password: string;
  isAdmin: boolean;
  blockStrangers: boolean;
  introduction: string;
  avatar: string | null;
  aiModel: string | null;
  aiPersonality: string | null;
};

export type UpdateUserInput = {
  id: string;
  email?: string;
  nickname?: string;
  isAdmin?: boolean;
  blockStrangers?: boolean;
  introduction?: string;
  avatar?: string | null;
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

export type FollowUserPair = {
  followerId: string;
  followeeId: string;
};

export type BlockUserPair = {
  blockerId: string;
  blockeeId: string;
};

export type ListFriendsByNicknamePrefixInput = {
  focusUserId: string;
  nicknamePrefix: string;
  offset?: number;
  limit?: number;
  omitSelf?: boolean;
  omitOthers?: boolean;
};
