import { jest } from "@jest/globals";

const humanUserId = "0000000000000001";
const aiUserId = "0000000000000002";
const otherHumanUserId = "0000000000000003";
const recipientUserId = "0000000000000010";
const postId = "0000000000000100";

const toDec = (hex: string): string => BigInt(`0x${hex}`).toString();

const mockSaveCursor = jest.fn(
  async (_client: unknown, _consumer: string, _partitionId: number, _eventId: bigint) => {},
);
const mockLoadCursor = jest.fn(async () => 0n);
const mockFetchBatch = jest.fn() as any;
mockFetchBatch.mockResolvedValueOnce([
  { event_id: "1000", payload: { type: "like", userId: humanUserId, postId } },
  { event_id: "1001", payload: { type: "like", userId: aiUserId, postId } },
  { event_id: "1002", payload: { type: "like", userId: otherHumanUserId, postId } },
  {
    event_id: "1003",
    payload: { type: "follow", followerId: aiUserId, followeeId: recipientUserId },
  },
  {
    event_id: "1004",
    payload: { type: "reply", userId: aiUserId, postId: "0000000000000200", replyToPostId: postId },
  },
  {
    event_id: "1005",
    payload: { type: "mention", userId: aiUserId, postId, mentionedUserId: recipientUserId },
  },
  {
    event_id: "1006",
    payload: { type: "mention", userId: humanUserId, postId, mentionedUserId: recipientUserId },
  },
  {
    event_id: "1007",
    payload: { type: "pub-comment", postId, commentId: "0000000000000300", commenterNickname: "guest" },
  },
]);
mockFetchBatch.mockResolvedValueOnce([]);
const mockPurgeEventLogs = jest.fn(async () => 0);
const mockPurgeNotifications = jest.fn(async () => 0);

const transactionQueries: Array<[string, unknown[] | undefined]> = [];
const transactionClient = {
  query: jest.fn(async (sql: string, params?: unknown[]) => {
    transactionQueries.push([sql, params]);
    if (/SELECT id, nickname/i.test(sql)) {
      return {
        rows: [
          { id: toDec(humanUserId), nickname: "human" },
          { id: toDec(otherHumanUserId), nickname: "other" },
        ],
      };
    }
    if (/SELECT id, snippet/i.test(sql)) {
      return { rows: [{ id: toDec(postId), snippet: "[]" }] };
    }
    if (/SELECT payload::json AS payload FROM notifications/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  }),
  release: jest.fn(),
};

const dataPool = {
  query: jest.fn(async (sql: string) => {
    if (/ai_model IS NOT NULL/i.test(sql)) {
      return { rows: [{ id: toDec(aiUserId) }] };
    }
    if (/SELECT id\s+FROM users/i.test(sql)) {
      return {
        rows: [
          { id: toDec(humanUserId) },
          { id: toDec(aiUserId) },
          { id: toDec(otherHumanUserId) },
        ],
      };
    }
    if (/SELECT id, owned_by/i.test(sql)) {
      return { rows: [{ id: toDec(postId), owned_by: toDec(recipientUserId) }] };
    }
    if (/SELECT id, timezone/i.test(sql)) {
      return { rows: [{ id: toDec(recipientUserId), timezone: "Asia/Tokyo" }] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }),
  connect: jest.fn(async () => transactionClient),
  end: jest.fn(async () => {}),
};

const lockClient = {
  query: jest.fn(async () => ({ rows: [{ ok: true }] })),
  release: jest.fn(),
};
const lockPool = {
  connect: jest.fn(async () => lockClient),
  end: jest.fn(async () => {}),
};

const mockRedis = {
  subscribe: jest.fn(async () => 1),
  on: jest.fn(),
  quit: jest.fn(async () => "OK"),
};

const mockConnectPgWithRetry = jest.fn() as any;
mockConnectPgWithRetry.mockResolvedValueOnce(lockPool);
mockConnectPgWithRetry.mockResolvedValueOnce(dataPool);

jest.mock("./config", () => ({
  Config: {
    DEFAULT_TIMEZONE: "Asia/Tokyo",
    EVENT_LOG_PARTITIONS: 1,
    NOTIFICATION_WORKERS: 1,
    NOTIFICATION_BATCH_SIZE: 100,
    NOTIFICATION_BUFFER_FLUSH_MS: 60_000,
    NOTIFICATION_BUFFER_MAX_EVENTS: 8,
    NOTIFICATION_PAYLOAD_RECORDS: 10,
  },
}));

jest.mock("./utils/servers", () => ({
  connectPgWithRetry: mockConnectPgWithRetry,
  connectRedisWithRetry: jest.fn(async () => mockRedis),
}));

jest.mock("./services/eventLog", () => ({
  EventLogService: jest.fn().mockImplementation(() => ({
    loadCursor: mockLoadCursor,
    fetchBatch: mockFetchBatch,
    saveCursor: mockSaveCursor,
    purgeOldRecords: mockPurgeEventLogs,
  })),
}));

jest.mock("./services/notifications", () => ({
  NotificationsService: jest.fn().mockImplementation(() => ({
    purgeOldRecords: mockPurgeNotifications,
  })),
}));

jest.mock("./services/idIssue", () => ({
  IdIssueService: {
    bigIntToDate: (id: bigint) => new Date(Number(id)),
  },
}));

jest.mock("./utils/snippet", () => ({
  makeTextFromJsonSnippet: jest.fn(() => "post snippet"),
}));

jest.mock("./utils/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { lifecycle, startNotificationWorker } from "./notificationWorker";

describe("notificationWorker buffering", () => {
  test("writes human mentions and excludes every AI actor event type", async () => {
    await startNotificationWorker();

    const inserts = transactionQueries.filter(([sql]) => /INSERT INTO notifications/i.test(sql));
    expect(inserts).toHaveLength(3);

    const likeInsert = inserts.find(([, params]) => params?.[1] === `like:${postId}`);
    expect(likeInsert).toBeDefined();
    const likeParams = likeInsert![1] as unknown[];
    const likePayload = JSON.parse(String(likeParams[3])) as {
      countUsers: number;
      records: Array<{ userId: string }>;
    };
    expect(likePayload.countUsers).toBe(2);
    expect(likePayload.records.map((record) => record.userId).sort()).toEqual(
      [humanUserId, otherHumanUserId].sort(),
    );
    expect(likePayload.records.some((record) => record.userId === aiUserId)).toBe(false);

    const mentionInsert = inserts.find(([, params]) => params?.[1] === `mention:${postId}`);
    expect(mentionInsert).toBeDefined();
    const mentionParams = mentionInsert![1] as unknown[];
    const mentionPayload = JSON.parse(String(mentionParams[3])) as {
      countUsers: number;
      countPosts: number;
      records: Array<{ userId: string; postId: string }>;
    };
    expect(mentionPayload.countUsers).toBe(1);
    expect(mentionPayload.countPosts).toBe(1);
    expect(mentionPayload.records).toEqual([
      expect.objectContaining({ userId: humanUserId, postId }),
    ]);
    expect(mentionPayload.records.some((record) => record.userId === aiUserId)).toBe(false);

    const commentInsert = inserts.find(([, params]) => params?.[1] === `pub-comment:${postId}`);
    expect(commentInsert).toBeDefined();
    const commentParams = commentInsert![1] as unknown[];
    const commentPayload = JSON.parse(String(commentParams[3])) as {
      countComments: number;
      records: Array<{ commentId: string; commenterNickname: string; postId: string }>;
    };
    expect(commentPayload.countComments).toBe(1);
    expect(commentPayload.records).toEqual([
      expect.objectContaining({
        commentId: "0000000000000300",
        commenterNickname: "guest",
        postId,
      }),
    ]);

    const updatedAtValues = inserts.map(([, params]) => String(params?.[4]));
    expect(new Set(updatedAtValues).size).toBe(1);
    expect(Date.parse(updatedAtValues[0]!)).toBeGreaterThan(1_000_000_000_000);

    expect(mockSaveCursor).toHaveBeenCalledTimes(1);
    expect(mockSaveCursor.mock.calls[0][2]).toBe(0);
    expect(mockSaveCursor.mock.calls[0][3]).toBe(1007n);

    await lifecycle.stop();
  });
});
