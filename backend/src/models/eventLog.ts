export type ReplyEventPayload = {
  type: "reply";
  userId: string;
  postId: string;
  replyToPostId: string;
};

export type LikeEventPayload = {
  type: "like";
  userId: string;
  postId: string;
};

export type FollowEventPayload = {
  type: "follow";
  followerId: string;
  followeeId: string;
};

export type AnyEventPayload = ReplyEventPayload | LikeEventPayload | FollowEventPayload;
