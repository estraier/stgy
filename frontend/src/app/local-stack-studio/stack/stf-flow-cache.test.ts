import {
  validateStfCachedFlow, stfFlowSessionKey,
  readStfCachedFlow, writeStfCachedFlow,
} from "./stf-flow-cache";

describe("STF session-owned bidirectional Flow cache", () => {
  test("the same session and geometry reuse Flow; a different session or alignment never does", () => {
    const a = stfFlowSessionKey("session-a", 0, 1, "aligned-v1", 2, 2);
    expect(a).not.toBeNull();
    expect(stfFlowSessionKey("session-a", 0, 1, "aligned-v1", 2, 2)).toBe(a);
    expect(stfFlowSessionKey("session-b", 0, 1, "aligned-v1", 2, 2)).not.toBe(a);
    expect(stfFlowSessionKey("session-a", 0, 1, "aligned-v2", 2, 2)).not.toBe(a);
    expect(stfFlowSessionKey("session-a", 1, 0, "aligned-v1", 2, 2)).not.toBe(a);
    expect(stfFlowSessionKey("session-a", 0, 1, "aligned-v1", 1, 4)).not.toBe(a);
    expect(stfFlowSessionKey("", 0, 1, "align", 2, 2)).toBeNull();
    expect(stfFlowSessionKey("session-a", 0, 0, "align", 2, 2)).toBeNull();
  });
  test("validates session identity and both finite 4MP vector fields, independent of age", () => {
    const now = 1_700_000_000_000;
    const value = { key: "same-real-pair", sessionId: "session-a", width: 2, height: 2,
      createdAt: now - 3_600_000, forward: new Float32Array(8), backward: new Float32Array(8) };
    expect(validateStfCachedFlow(value, "session-a", 2, 2, now)).toBe(true);
    expect(validateStfCachedFlow(value, "session-b", 2, 2, now)).toBe(false);
    expect(validateStfCachedFlow(value, "session-a", 3, 2, now)).toBe(false);
    expect(validateStfCachedFlow({ ...value, backward: new Float32Array(6) }, "session-a", 2, 2, now)).toBe(false);
    expect(validateStfCachedFlow({ ...value, forward: Float32Array.from([NaN, 0, 0, 0, 0, 0, 0, 0]) }, "session-a", 2, 2, now)).toBe(false);
    expect(validateStfCachedFlow({ ...value, backward: Float32Array.from([Infinity, 0, 0, 0, 0, 0, 0, 0]) }, "session-a", 2, 2, now)).toBe(false);
    expect(validateStfCachedFlow({ ...value, createdAt: now + 1 }, "session-a", 2, 2, now)).toBe(false);
  });
  test("no IndexedDB is a cache miss and does not stop image processing", async () => {
    if (typeof indexedDB !== "undefined") return;
    const key = stfFlowSessionKey("session-a", 0, 1, "align", 2, 2)!;
    expect(await readStfCachedFlow("session-a", key, 2, 2)).toBeNull();
    expect(await writeStfCachedFlow("session-a", key, Date.now(), 2, 2,
      new Float32Array(8), new Float32Array(8))).toBe(false);
  });
});
