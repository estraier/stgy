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
  blockStrangers: boolean;
  snippet: string;
  avatar: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string | null;
  countFollowers: number;
  countFollowees: number;
  countPosts: number;
  isFollowedByFocusUser?: boolean | null;
  isFollowingFocusUser?: boolean | null;
  isBlockedByFocusUser?: boolean | null;
  isBlockingFocusUser?: boolean | null;
};

export type UserDetail = User & {
  introduction: string;
  aiPersonality: string | null;
};

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
  isLikedByFocusUser?: boolean | null;
  isRepliedByFocusUser?: boolean | null;
  isBlockingFocusUser?: boolean | null;
};

export type PostDetail = Post & {
  content: string;
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
  userNickname: string;
  ts: number;
};

export type NotificationPostRecord = {
  userId: string;
  userNickname: string;
  postId: string;
  postSnippet: string;
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
  slot: string;
  term: string;
  isRead: boolean;
};

export type MarkAllNotificationsInput = {
  isRead: boolean;
};
