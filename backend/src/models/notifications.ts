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
  day: string;
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
  day: string;
  isRead: boolean;
};

export type MarkAllNotificationsInput = {
  userId: string;
  isRead: boolean;
};
