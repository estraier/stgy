export type User = {
  id: string;
  nickname: string;
  avatar: string | null;
  aiModel: string | null;
  snippet: string;
  isAdmin: boolean;
  blockStrangers: boolean;
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
  email: string;
  locale: string;
  timezone: string;
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
  avatar: string | null;
  aiModel: string | null;
  locale: string;
  timezone: string;
  isAdmin: boolean;
  blockStrangers: boolean;
  introduction: string;
  aiPersonality: string | null;
};

export type UpdateUserInput = {
  id: string;
  email?: string;
  nickname?: string;
  avatar?: string | null;
  aiModel?: string | null;
  locale?: string;
  timezone?: string;
  isAdmin?: boolean;
  blockStrangers?: boolean;
  introduction?: string;
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

export type ListBlockeesInput = {
  blockerId: string;
} & UserPagination;

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

export type PubConfig = {
  siteName: string;
  subtitle: string;
  author: string;
  introduction: string;
  designTheme: string;
  showServiceHeader: boolean;
  showSiteName: boolean;
  showPagenation: boolean;
  showSideProfile: boolean;
  showSideRecent: boolean;
  locale?: string;
};
