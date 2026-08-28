export type PubCommentStatus = "pending" | "published";

export type PubComment = {
  id: string;
  postId: string;
  nickname: string;
  body: string;
  status: PubCommentStatus;
  isAuthor: boolean;
  createdAt: string;
};


export type PubCommentOrder = "newest" | "oldest";
