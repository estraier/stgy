export type Post = {
  id: string;
  snippet: string;
  ownedBy: string;
  replyTo: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  createdAt: string;
  updatedAt: string | null;
  ownerNickname: string;
  replyToOwnerNickname: string | null;
  countLikes: number;
  countReplies: number;
  tags: string[];
  isLikedByFocusUser?: boolean;
  isRepliedByFocusUser?: boolean;
};

export type PostLite = Omit<Post, "snippet" | "isLikedByFocusUser" | "isRepliedByFocusUser">;

export type PostDetail = Post & {
  content: string;
};

export type PostFilter = {
  query?: string;
  ownedBy?: string;
  tag?: string;
  replyTo?: string | null;
};

export type PostPagination = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export type CountPostsInput = PostFilter;

export type ListPostsInput = PostFilter & PostPagination;

export type CreatePostInput = {
  id?: string;
  content: string;
  ownedBy: string;
  replyTo: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  tags: string[];
};

export type UpdatePostInput = {
  id: string;
  ownedBy?: string;
  content?: string;
  replyTo?: string | null;
  allowLikes?: boolean;
  allowReplies?: boolean;
  tags?: string[];
};

export type ListPostsByFolloweesInput = {
  userId: string;
  includeSelf?: boolean;
  includeReplies?: boolean;
} & PostPagination;

export type ListPostsLikedByUserInput = {
  userId: string;
  includeReplies?: boolean;
} & PostPagination;

export type ListLikersInput = {
  postId: string;
} & PostPagination;
