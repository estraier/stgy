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
  userId: string;
  slot: string;
  term: string;
  isRead: boolean;
};

export type MarkAllNotificationsInput = {
  userId: string;
  isRead: boolean;
};
