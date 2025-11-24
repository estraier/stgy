export type Post = {
  id: string;
  ownedBy: string;
  replyTo: string | null;
  snippet: string;
  locale: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  ownerNickname: string;
  ownerLocale: string;
  replyToOwnerNickname: string | null;
  countLikes: number;
  countReplies: number;
  tags: string[];
  isLikedByFocusUser?: boolean;
  isRepliedByFocusUser?: boolean;
  isBlockingFocusUser?: boolean;
};

export type PostLite = Omit<
  Post,
  "snippet" | "locale" | "isLikedByFocusUser" | "isRepliedByFocusUser" | "isBlockingFocusUser"
>;

export type PostDetail = Post & {
  content: string;
};

export type PubPostDetail = PostDetail & {
  olderPostId: string | null;
  newerPostId: string | null;
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
  locale: string | null;
  ownedBy: string;
  replyTo: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  publishedAt: string | null;
  tags: string[];
};

export type UpdatePostInput = {
  id: string;
  ownedBy?: string;
  content?: string;
  locale?: string | null;
  replyTo?: string | null;
  allowLikes?: boolean;
  allowReplies?: boolean;
  publishedAt?: string | null;
  tags?: string[];
};

export type ListPostsByFolloweesInput = {
  userId: string;
  includeSelf?: boolean;
  includeReplies?: boolean;
  limitPerUser?: number;
} & PostPagination;

export type ListPostsLikedByUserInput = {
  userId: string;
  includeReplies?: boolean;
} & PostPagination;

export type ListLikersInput = {
  postId: string;
} & PostPagination;
