export type Post = {
  id: string;
  content: string;
  ownedBy: string;
  replyTo: string | null;
  allowReplies: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type PostDetail = Post & {
  ownerNickname: string;
  replyToOwnerNickname: string | null;
  replyCount: number;
  likeCount: number;
  tags: string[];
  isLikedByFocusUser?: boolean;
  isRepliedByFocusUser?: boolean;
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
  content: string;
  ownedBy: string;
  replyTo: string | null;
  allowReplies: boolean;
  tags: string[];
};

export type UpdatePostInput = {
  id: string;
  ownedBy?: string;
  content?: string;
  replyTo?: string | null;
  allowReplies?: boolean;
  tags?: string[];
};

export type ListPostsByFolloweesDetailInput = {
  userId: string;
  includeSelf?: boolean;
  includeReplies?: boolean;
} & PostPagination;

export type ListPostsLikedByUserDetailInput = {
  userId: string;
  includeReplies?: boolean;
} & PostPagination;

export type ListLikersInput = {
  postId: string;
} & PostPagination;
