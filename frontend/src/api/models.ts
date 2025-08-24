export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  userUpdatedAt: string | null;
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
  avatar: string | null;
  aiModel: string | null;
  aiPersonality: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type UserDetail = User & {
  countFollowers: number;
  countFollowees: number;
  countPosts: number;
  isFollowedByFocusUser?: boolean | null;
  isFollowingFocusUser?: boolean | null;
};

export type Post = {
  id: string;
  content: string;
  ownedBy: string;
  replyTo: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type PostDetail = Post & {
  ownerNickname: string;
  replyToOwnerNickname: string | null;
  countLikes: number;
  countReplies: number;
  tags: string[];
  isLikedByFocusUser?: boolean | null;
  isRepliedByFocusUser?: boolean | null;
};

export type StorageObjectMetadata = {
  bucket: string;
  key: string;
  size: number;
  etag?: string | null;
  lastModified?: string | null;
  storageClass?: string | null;
  contentType?: string | null;
};

export type MediaObject = StorageObjectMetadata & {
  publicUrl: string;
};

export type PresignedPostResult = {
  url: string;
  fields: Record<string, string>;
  objectKey: string;
  maxBytes?: number | null;
  expiresInSec: number;
};

export type StorageMonthlyQuota = {
  userId: string;
  yyyymm: string;
  bytesMasters: number;
  bytesThumbs: number;
  bytesTotal: number;
  limitSingleBytes: number | null;
  limitMonthlyBytes: number | null;
};

export type NotificationUserRecord = {
  userId: string;
  ts: number;
};

export type NotificationPostRecord = {
  userId: string;
  postId: string;
  ts: number;
};

export type NotificationAnyRecord = NotificationUserRecord | NotificationPostRecord;

export type Notification = {
  slot: string;
  term: string;
  isRead: boolean;
  updatedAt: string;
  createdAt: string;
  countUsers?: number;
  countPosts?: number;
  records: NotificationAnyRecord[];
};

export type MarkNotificationInput = {
  userId: string;
  slot: string;
  term: string;
  isRead: boolean;
};

export type MarkAllNotificationsInput = {
  userId: string;
  isRead: boolean;
};
