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

export type PostFilter = {
  query?: string;
  owned_by?: string;
  tag?: string;
  reply_to?: string;
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
  owned_by: string;
  reply_to?: string | null;
};

export type UpdatePostInput = {
  id: string;
  content?: string;
  reply_to?: string | null;
};

export type ListPostsByFolloweesDetailInput = {
  user_id: string;
  include_self?: boolean;
} & PostPagination;

export type ListPostsLikedByUserDetailInput = {
  user_id: string;
} & PostPagination;

export type ListLikersInput = {
  post_id: string;
} & PostPagination;
