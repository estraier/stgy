const mockCanonicalCleanup = jest.fn<Promise<number>, [number]>();
const mockScratchCleanup = jest.fn<Promise<void>, [number]>();
const mockFlowCleanup = jest.fn<Promise<number>, [number]>();

jest.mock("./canonical-source", () => ({
  purgeExpiredCanonicalSessions: (cutoff: number) => mockCanonicalCleanup(cutoff),
}));
jest.mock("./scratch", () => ({
  purgeExpiredStackScratchSessions: (cutoff: number) => mockScratchCleanup(cutoff),
}));
jest.mock("./stf-flow-cache", () => ({
  purgeExpiredStfFlowSessions: (cutoff: number) => mockFlowCleanup(cutoff),
}));

describe("LSS new-session cleanup", () => {
  let now = 10_000_000;
  beforeEach(() => {
    jest.resetModules();
    now += 5_000_000;
    mockCanonicalCleanup.mockReset().mockResolvedValue(0);
    mockScratchCleanup.mockReset().mockResolvedValue(undefined);
    mockFlowCleanup.mockReset().mockResolvedValue(0);
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test("every new session cleans all three stores at a strict 1800 second cutoff", async () => {
    const { cleanupLssTemporaryCacheOnNewSession } = await import("./cache-cleanup");
    await cleanupLssTemporaryCacheOnNewSession();
    expect(mockCanonicalCleanup).toHaveBeenCalledWith(now - 1_800_000);
    expect(mockScratchCleanup).toHaveBeenCalledWith(now - 1_800_000);
    expect(mockFlowCleanup).toHaveBeenCalledWith(now - 1_800_000);
    now += 1;
    await cleanupLssTemporaryCacheOnNewSession();
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(2);
  });
  test("failed cleanup does not block a retry at the next new session", async () => {
    const { cleanupLssTemporaryCacheOnNewSession } = await import("./cache-cleanup");
    mockScratchCleanup.mockRejectedValueOnce(new Error("scratch failed"));
    await expect(cleanupLssTemporaryCacheOnNewSession()).rejects.toThrow("scratch failed");
    await cleanupLssTemporaryCacheOnNewSession();
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(2);
  });
});
