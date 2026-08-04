import {
  EDITING_HISTORY_DAILY_FINAL_RETENTION_MS,
  EDITING_HISTORY_PERIODIC_RETENTION_MS,
  EDITING_HISTORY_SAVED_RETENTION_MS,
  findEditingHistoryDailyFinalIds,
  formatEditingHistorySavedDate,
  formatEditingHistoryTimestamp,
  getEditingHistoryRetentionMs,
  makeEditingHistoryPreview,
  makeEditingHistorySnapshotId,
  type EditingHistorySnapshot,
} from "./editingHistory";

function snapshot(
  id: string,
  timestamp: number,
  kind: "periodic" | "saved",
  savedDate: string | null,
): EditingHistorySnapshot {
  return {
    id,
    schemaVersion: 2,
    ownerUserId: "0001000000000021",
    targetType: "post",
    targetId: "1234abcd1234abcd",
    timestamp,
    contentHash: id,
    preview: id,
    compression: "gzip",
    compressedByteSize: 100,
    uncompressedByteSize: 200,
    kind,
    savedDate,
    savedTimezone: savedDate ? "Asia/Tokyo" : null,
  };
}

describe("editing history identifiers", () => {
  test("includes owner, target, millisecond timestamp, and target id", () => {
    const timestamp = new Date(2026, 7, 4, 19, 30, 25, 123).getTime();
    expect(
      makeEditingHistorySnapshotId(
        "0001000000000021",
        { type: "post", id: "1234abcd1234abcd" },
        timestamp,
      ),
    ).toBe(
      `stgy-editing-history-0001000000000021-post-${formatEditingHistoryTimestamp(timestamp)}-1234abcd1234abcd`,
    );
  });
});

describe("editing history preview", () => {
  test("truncates by Unicode code point", () => {
    expect(makeEditingHistoryPreview("a😀b", 2)).toBe("a😀");
  });
});

describe("editing history saved dates", () => {
  test("uses the specified timezone", () => {
    const timestamp = Date.UTC(2026, 7, 4, 15, 30, 0);
    expect(formatEditingHistorySavedDate(timestamp, "Asia/Tokyo")).toBe("2026-08-05");
  });
});

describe("editing history retention", () => {
  test("selects the last saved snapshot of each post and date dynamically", () => {
    const periodic = snapshot("periodic", 1000, "periodic", null);
    const firstSaved = snapshot("saved-1", 2000, "saved", "2026-08-04");
    const lastSaved = snapshot("saved-2", 3000, "saved", "2026-08-04");
    const nextDaySaved = snapshot("saved-3", 4000, "saved", "2026-08-05");
    const finalIds = findEditingHistoryDailyFinalIds([
      periodic,
      firstSaved,
      lastSaved,
      nextDaySaved,
    ]);

    expect(finalIds).toEqual(new Set(["saved-2", "saved-3"]));
    expect(getEditingHistoryRetentionMs(periodic, finalIds)).toBe(
      EDITING_HISTORY_PERIODIC_RETENTION_MS,
    );
    expect(getEditingHistoryRetentionMs(firstSaved, finalIds)).toBe(
      EDITING_HISTORY_SAVED_RETENTION_MS,
    );
    expect(getEditingHistoryRetentionMs(lastSaved, finalIds)).toBe(
      EDITING_HISTORY_DAILY_FINAL_RETENTION_MS,
    );
  });
});
