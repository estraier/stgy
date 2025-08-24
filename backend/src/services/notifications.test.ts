import { jest } from "@jest/globals";
import { NotificationService } from "./notifications";

jest.mock("../config", () => ({
  Config: {
    NOTIFICATION_SHOWN_RECORDS: 3,
    NOTIFICATION_RETENTION_DAYS: 90,
  },
}));

describe("NotificationService (happy paths)", () => {
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
      { userId: "u1", ts: 1000 },
      { userId: "u2", postId: "p1", ts: 2000 },
    ],
  };

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
    const out = await svc.listFeed("USER-1");

    expect(query).toHaveBeenNthCalledWith(1, expect.stringMatching(/FROM notifications/i), [
      "USER-1",
      3,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/FROM notifications/i), [
      "USER-1",
      3,
    ]);

    expect(out.map((n) => n.updatedAt)).toEqual([
      "2025-08-24T12:00:00.000Z",
      "2025-08-24T11:00:00.000Z",
      "2025-08-24T10:00:00.000Z",
      "2025-08-24T09:00:00.000Z",
    ]);

    const first = out[0]!;
    expect(first.slot).toBe("follow");
    expect(first.isRead).toBe(false);
    expect(first.countUsers).toBe(2);
    expect(first.countPosts).toBe(1);
    expect(first.records).toHaveLength(2);
    expect(typeof first.records[0]!.userId).toBe("string");
    expect(typeof first.records[0]!.ts).toBe("number");
  });

  test("markNotification: updates a single notification", async () => {
    const { svc, query } = mkSvc();
    await svc.markNotification({
      userId: "U",
      slot: "like:POST-1",
      term: "2025-08-24",
      isRead: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE notifications\s+SET is_read/i),
      ["U", "like:POST-1", "2025-08-24", true],
    );
  });

  test("markAllNotifications: bulk update only rows with differing state", async () => {
    const { svc, query } = mkSvc();
    await svc.markAllNotifications({ userId: "U2", isRead: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE notifications[\s\S]*WHERE user_id = \$1[\s\S]*AND is_read = \$3/i,
      ),
      ["U2", false, true],
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
