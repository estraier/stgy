export type PubCommentStatus = "pending" | "published";

export type PubComment = {
  id: string;
  postId: string;
  name: string;
  body: string;
  status: PubCommentStatus;
  isAuthor: boolean;
  createdAt: string;
};


export type PubCommentOrder = "newest" | "oldest";
