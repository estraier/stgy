import { jest } from "@jest/globals";
import { NotificationService } from "./notifications";

jest.mock("../config", () => ({
  Config: {
    NOTIFICATION_SHOWN_RECORDS: 3,
    NOTIFICATION_RETENTION_DAYS: 90,
  },
}));

describe("NotificationService", () => {
  function mkSvc(withQueryMock?: jest.Mock) {
    const query = (withQueryMock ?? (jest.fn() as any)) as any;
    const pg = { query } as any;
    const svc = new NotificationService(pg);
    return { svc, query };
  }

  const samplePayload = {
    countUsers: 2,
    countPosts: 1,
    records: [
      { userId: "123", userNickname: "User One", ts: 1000 },
      {
        userId: "456",
        userNickname: "User Two",
        postId: "789",
        postSnippet: "hello world",
        ts: 2000,
      },
    ],
  };

  const UID_HEX = "00000000000000A1";

  test("listFeed: merges unread/read by updated_at desc and applies limit", async () => {
    const unreadRows = [
      {
        slot: "follow",
        term: "2025-08-24",
        is_read: false,
        payload: samplePayload,
        updated_at: "2025-08-24T12:00:00.000Z",
        created_at: "2025-08-24T09:00:00.000Z",
      },
      {
        slot: "like:postA",
        term: "2025-08-24",
        is_read: false,
        payload: samplePayload,
        updated_at: "2025-08-24T10:00:00.000Z",
        created_at: "2025-08-24T08:59:00.000Z",
      },
    ];
    const readRows = [
      {
        slot: "reply:root1",
        term: "2025-08-24",
        is_read: true,
        payload: samplePayload,
        updated_at: "2025-08-24T11:00:00.000Z",
        created_at: "2025-08-24T08:00:00.000Z",
      },
      {
        slot: "follow",
        term: "2025-08-23",
        is_read: true,
        payload: samplePayload,
        updated_at: "2025-08-24T09:00:00.000Z",
        created_at: "2025-08-23T21:00:00.000Z",
      },
    ];

    const q = (jest.fn() as any)
      .mockResolvedValueOnce({ rows: unreadRows })
      .mockResolvedValueOnce({ rows: readRows });

    const { svc, query } = mkSvc(q);
    const out = await svc.listFeed(UID_HEX);

    expect(query).toHaveBeenNthCalledWith(1, expect.stringMatching(/FROM notifications/i), [
      expect.stringMatching(/^\d+$/),
      3,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/FROM notifications/i), [
      expect.stringMatching(/^\d+$/),
      3,
    ]);

    expect(out!.map((n) => n.updatedAt)).toEqual([
      "2025-08-24T12:00:00.000Z",
      "2025-08-24T11:00:00.000Z",
      "2025-08-24T10:00:00.000Z",
      "2025-08-24T09:00:00.000Z",
    ]);

    const first = out![0]!;
    expect(first.slot).toBe("follow");
    expect(first.isRead).toBe(false);
    expect(first.countUsers).toBe(2);
    expect(first.countPosts).toBe(1);
    expect(first.records).toHaveLength(2);

    const nicknames = first.records.map((r) => r.userNickname);
    expect(nicknames).toEqual(["User One", "User Two"]);
  });

  test("listFeed: newerThan specified and no newer rows -> returns null and only existence check runs", async () => {
    const existsNone = { rowCount: 0, rows: [] };

    const q = (jest.fn() as any).mockResolvedValueOnce(existsNone);

    const { svc, query } = mkSvc(q);
    const newerThan = new Date("2025-08-24T12:34:56.000Z");
    const out = await svc.listFeed(UID_HEX, { newerThan });

    expect(out).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT\s+1\s+FROM\s+notifications[\s\S]*updated_at\s*>\s*\$2/i),
      [expect.stringMatching(/^\d+$/), newerThan],
    );
  });

  test("listFeed: newerThan specified and newer rows exist -> runs existence check + unread + read", async () => {
    const existsYes = { rowCount: 1, rows: [{ ok: 1 }] };
    const unreadRows = [
      {
        slot: "follow",
        term: "2025-08-25",
        is_read: false,
        payload: samplePayload,
        updated_at: "2025-08-25T01:00:00.000Z",
        created_at: "2025-08-25T00:30:00.000Z",
      },
    ];
    const readRows: any[] = [];

    const q = (jest.fn() as any)
      .mockResolvedValueOnce(existsYes)
      .mockResolvedValueOnce({ rows: unreadRows })
      .mockResolvedValueOnce({ rows: readRows });

    const { svc, query } = mkSvc(q);
    const newerThan = new Date("2025-08-24T23:59:59.000Z");
    const out = await svc.listFeed(UID_HEX, { newerThan });

    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.records.map((r) => r.userNickname)).toEqual(["User One", "User Two"]);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/SELECT\s+1\s+FROM\s+notifications[\s\S]*updated_at\s*>\s*\$2/i),
      [expect.stringMatching(/^\d+$/), newerThan],
    );
    expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/FROM notifications/i), [
      expect.stringMatching(/^\d+$/),
      3,
    ]);
    expect(query).toHaveBeenNthCalledWith(3, expect.stringMatching(/FROM notifications/i), [
      expect.stringMatching(/^\d+$/),
      3,
    ]);
  });

  test("markNotification: updates a single notification", async () => {
    const { svc, query } = mkSvc();
    await svc.markNotification({
      userId: UID_HEX,
      slot: "like:POST-1",
      term: "2025-08-24",
      isRead: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE notifications\s+SET is_read/i),
      [expect.stringMatching(/^\d+$/), "like:POST-1", "2025-08-24", true],
    );
  });

  test("markAllNotifications: bulk update only rows with differing state", async () => {
    const { svc, query } = mkSvc();
    await svc.markAllNotifications({ userId: UID_HEX, isRead: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE notifications[\s\S]*WHERE user_id = \$1[\s\S]*AND is_read = \$3/i,
      ),
      [expect.stringMatching(/^\d+$/), false, true],
    );
  });

  test("purgeOldRecords: deletes by created_at and returns rowCount", async () => {
    const q = (jest.fn() as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 5, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const pg = { query: q } as any;
    const dummy = { query: jest.fn() } as any;
    const svc = new NotificationService(dummy);
    const deleted = await svc.purgeOldRecords(pg as any);
    expect(deleted).toBe(5);
    expect(q).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(q).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = 10000");
    expect(q.mock.calls[2]![0]).toMatch(/DELETE FROM notifications/i);
    expect(q.mock.calls[2]![1]).toEqual([90]);
    expect(q).toHaveBeenNthCalledWith(4, "COMMIT");
  });
});
