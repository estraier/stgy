import { LSS_CACHE_RETENTION_MS } from "./cache-cleanup";
import { stackScratchExpiryUpperKey, stackScratchSessionIdAt, createStackScratchSessionId, stackScratchKeyBelongsToCanonicalSession } from "./scratch";

describe("LSS new-session expiry policy", () => {
  test("1800 second creation-age cutoff has no active-tab exception", () => {
    expect(LSS_CACHE_RETENTION_MS).toBe(1_800_000);
    const now = 1_762_700_000_000;
    const cutoff = now - LSS_CACHE_RETENTION_MS;
    const upper = stackScratchExpiryUpperKey(cutoff);
    expect(`${stackScratchSessionIdAt(cutoff - 1, "old")}:0:0:0` < upper).toBe(true);
    expect(`${stackScratchSessionIdAt(cutoff, "border")}:0:0:0` < upper).toBe(true);
    expect(`${stackScratchSessionIdAt(cutoff + 1, "new")}:0:0:0` < upper).toBe(false);
  });

  test("scratch job keys carry their Canonical owner and parent's creation time", () => {
    const createdAt = 1_762_700_000_000;
    const id = createStackScratchSessionId("parent-abc", createdAt);
    expect(id.startsWith(stackScratchSessionIdAt(createdAt, "parent-abc:"))).toBe(true);
    expect(stackScratchKeyBelongsToCanonicalSession(`${id}:0:2:3`, "parent-abc")).toBe(true);
    expect(stackScratchKeyBelongsToCanonicalSession(`${id}:0:2:3`, "parent-a")).toBe(false);
    expect(stackScratchKeyBelongsToCanonicalSession(`${id}:0:2:3`, "another-tab")).toBe(false);
    expect(`${id}:0:2:3` < stackScratchExpiryUpperKey(createdAt)).toBe(true);
  });
});
