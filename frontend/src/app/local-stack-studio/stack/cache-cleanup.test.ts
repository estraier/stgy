import { isLssCacheCleanupDue, LSS_CACHE_CLEANUP_INTERVAL_MS, LSS_CACHE_RETENTION_MS } from "./cache-cleanup";
import { stackScratchExpiryUpperKey, stackScratchSessionIdAt } from "./scratch";

describe("LSS Process-triggered cache cleanup policy", () => {
  test("runs only on first Process or after 1800 seconds since success", () => {
    const now = 10_000_000;
    expect(isLssCacheCleanupDue(0, now)).toBe(true);
    expect(isLssCacheCleanupDue(Number.NaN, now)).toBe(true);
    expect(isLssCacheCleanupDue(now - LSS_CACHE_CLEANUP_INTERVAL_MS + 1, now)).toBe(false);
    expect(isLssCacheCleanupDue(now - LSS_CACHE_CLEANUP_INTERVAL_MS, now)).toBe(true);
    expect(isLssCacheCleanupDue(now + 1000, now)).toBe(true); // Clock was reset.
    expect(LSS_CACHE_RETENTION_MS).toBe(3_600_000);
  });

  test("Scratch expiration covers only timestamped LSS sessions older than 3600 seconds", () => {
    const now = 1_762_700_000_000;
    const cutoff = now - LSS_CACHE_RETENTION_MS;
    const upper = stackScratchExpiryUpperKey(cutoff);
    const old = `${stackScratchSessionIdAt(cutoff - 1, "old")}:0:0:0`;
    const boundary = `${stackScratchSessionIdAt(cutoff, "border")}:0:0:0`;
    const fresh = `${stackScratchSessionIdAt(cutoff + 1, "new")}:0:0:0`;
    expect(old < upper).toBe(true);
    expect(boundary < upper).toBe(true);
    expect(fresh < upper).toBe(false);
    // Legacy scratch sessions (UUIDs) and data owned by another app are never
    // in the "s2-" range used by the new cleaner.
    expect("aaa-legacy-session:0:0:0" < "s2-").toBe(true);
    expect(() => stackScratchSessionIdAt(-1, "invalid")).toThrow();
  });
});
