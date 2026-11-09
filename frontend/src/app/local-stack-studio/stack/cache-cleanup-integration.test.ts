const mockCanonicalCleanup = jest.fn<Promise<number>, [number, string | undefined]>();
const mockScratchCleanup = jest.fn<Promise<void>, [number]>();

jest.mock("./canonical-source", () => ({
  purgeExpiredCanonicalSessions: (cutoff: number, protectedId?: string) => mockCanonicalCleanup(cutoff, protectedId),
}));
jest.mock("./scratch", () => ({
  purgeExpiredStackScratchSessions: (cutoff: number) => mockScratchCleanup(cutoff),
}));

describe("LSS Process cleanup scheduling", () => {
  let now = 10_000_000;
  let values: Map<string, string>;

  beforeEach(() => {
    jest.resetModules();
    mockCanonicalCleanup.mockReset().mockResolvedValue(0);
    mockScratchCleanup.mockReset().mockResolvedValue(undefined);
    now += 5_000_000;
    values = new Map();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    }});
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  test("cleans each LSS store only on first Process, then skips for 1800 seconds", async () => {
    const { cleanupLssTemporaryCacheOnProcess } = await import("./cache-cleanup");
    expect(await cleanupLssTemporaryCacheOnProcess("active-session")).toBe(true);
    expect(mockCanonicalCleanup).toHaveBeenCalledWith(now - 3_600_000, "active-session");
    expect(mockScratchCleanup).toHaveBeenCalledWith(now - 3_600_000);
    now += 1_799_999;
    expect(await cleanupLssTemporaryCacheOnProcess()).toBe(false);
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await cleanupLssTemporaryCacheOnProcess()).toBe(true);
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(2);
  });

  test("does not advance last successful time after failed scratch cleanup", async () => {
    const { cleanupLssTemporaryCacheOnProcess } = await import("./cache-cleanup");
    mockScratchCleanup.mockRejectedValueOnce(new Error("scratch failed"));
    await expect(cleanupLssTemporaryCacheOnProcess()).rejects.toThrow("scratch failed");
    expect(values.size).toBe(0);
    await expect(cleanupLssTemporaryCacheOnProcess()).resolves.toBe(true);
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(2);
  });
});
