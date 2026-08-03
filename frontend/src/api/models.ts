export type SessionInfo = {
  userId: string;
  userEmail: string;
  userNickname: string;
  userIsAdmin: boolean;
  userIsFrozen: boolean;
  userCreatedAt: string;
  userUpdatedAt: string | null;
  userLocale: string;
  userTimezone: string;
  loggedInAt: string;
  requiredAgreementTermId: string | null;
};

export type AgreementTermContent = {
  locale: string;
  text: string;
};

export type AgreementTerm = {
  id: string;
  contents: AgreementTermContent[];
};

export type LinkSnippetStatus =
  | "ready"
  | "unavailable"
  | "fetch_failed"
  | "pending";

export type LinkSnippet = {
  url: string;
  status: LinkSnippetStatus;
  title: string | null;
  description: string | null;
  siteName: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  stale: boolean;
  refreshing: boolean;
};

export type QueryStats = {
  id: string;
  query: string;
  calls: number;
  totalExecTime: number;
};

export type ExplainPlan = string[];

export type AIModel = {
  label: string;
  service: string;
  chatModel: string;
  featureModel: string;
};

export type User = {
  id: string;
  nickname: string;
  avatar: string | null;
  aiModel: string | null;
  snippet: string;
  isAdmin: boolean;
  isFrozen: boolean;
  blockStrangers: boolean;
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
  email: string;
  locale: string;
  timezone: string;
  introduction: string;
  aiPersonality: string | null;
};

export type Post = {
  id: string;
  ownedBy: string;
  replyTo: string | null;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  snippet: string;
  locale: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  ownerNickname: string;
  ownerLocale: string;
  replyToOwnerId: string | null;
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
  olderPostId: string | null;
  newerPostId: string | null;
};

export type AiPostSummary = {
  postId: string;
  sourceUpdatedAt: string;
  summary: string | null;
  features: Int8Array | null;
  tags: string[];
};

export type AiPostSummaryPacket = {
  postId: string;
  sourceUpdatedAt: string;
  summary: string | null;
  features: string | null;
  tags: string[];
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

export type TrackObject = StorageObjectMetadata & {
  publicUrl: string;
  previewKey: string;
  previewUrl: string;
};

export type FinalizedTrack = {
  master: TrackObject;
  preview: TrackObject;
};

export type TrackStorageMonthlyQuota = {
  userId: string;
  yyyymm: string;
  bytesMasters: number;
  bytesPreviews: number;
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

export type PubConfig = {
  siteName: string;
  subtitle: string;
  author: string;
  introduction: string;
  designTheme: string;
  showServiceHeader: boolean;
  showSiteName: boolean;
  showPagenation: boolean;
  showSideProfile: boolean;
  showSideRecent: boolean;
  locale?: string;
};
