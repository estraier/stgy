export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  loggedInAt: string;
};

export type AIModel = {
  name: string;
  description: string;
  inputCost: number;
  outputCost: number;
};

export type User = {
  id: string;
  email: string;
  nickname: string;
  isAdmin: boolean;
  introduction: string;
  icon: string | null;
  aiModel: string | null;
  aiPersonality: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type UserDetail = User & {
  countFollowers: number;
  countFollowees: number;
  isFollowedByFocusUser?: boolean | null;
  isFollowingFocusUser?: boolean | null;
};

export type Post = {
  id: string;
  content: string;
  ownedBy: string;
  replyTo: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type PostDetail = Post & {
  ownerNickname: string;
  replyToOwnerNickname: string | null;
  replyCount: number;
  likeCount: number;
  tags: string[];
  isLikedByFocusUser?: boolean | null;
  isRepliedByFocusUser?: boolean | null;
};
