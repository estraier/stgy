const mockCanonicalCleanup = jest.fn<Promise<number>, [number]>();
const mockScratchCleanup = jest.fn<Promise<void>, [number]>();
const mockFlowCleanup = jest.fn<Promise<number>, [number]>();
const mockCanonicalDelete = jest.fn<Promise<void>, [string]>();
const mockScratchDelete = jest.fn<Promise<number>, [string]>();
const mockFlowDelete = jest.fn<Promise<number>, [string]>();

jest.mock("./canonical-source", () => ({
  purgeExpiredCanonicalSessions: (cutoff: number) => mockCanonicalCleanup(cutoff),
  deleteCanonicalSession: (id: string) => mockCanonicalDelete(id),
}));
jest.mock("./scratch", () => ({
  purgeExpiredStackScratchSessions: (cutoff: number) => mockScratchCleanup(cutoff),
  deleteStackScratchCanonicalSession: (id: string) => mockScratchDelete(id),
}));
jest.mock("./stf-flow-cache", () => ({
  purgeExpiredStfFlowSessions: (cutoff: number) => mockFlowCleanup(cutoff),
  deleteStfFlowSession: (id: string) => mockFlowDelete(id),
}));

describe("LSS new-session cleanup", () => {
  let now = 10_000_000;
  beforeEach(() => {
    jest.resetModules();
    now += 5_000_000;
    mockCanonicalCleanup.mockReset().mockResolvedValue(0);
    mockScratchCleanup.mockReset().mockResolvedValue(undefined);
    mockFlowCleanup.mockReset().mockResolvedValue(0);
    mockCanonicalDelete.mockReset().mockResolvedValue(undefined);
    mockScratchDelete.mockReset().mockResolvedValue(0);
    mockFlowDelete.mockReset().mockResolvedValue(0);
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
    await expect(cleanupLssTemporaryCacheOnNewSession()).rejects.toThrow("1 store");
    await cleanupLssTemporaryCacheOnNewSession();
    expect(mockCanonicalCleanup).toHaveBeenCalledTimes(2);
  });

  test("immediate old-session deletion always targets Canonical, Scratch, and Flow", async () => {
    const { deleteLssSession } = await import("./cache-cleanup");
    await deleteLssSession("previous-tab-session");
    expect(mockCanonicalDelete).toHaveBeenCalledWith("previous-tab-session");
    expect(mockScratchDelete).toHaveBeenCalledWith("previous-tab-session");
    expect(mockFlowDelete).toHaveBeenCalledWith("previous-tab-session");
  });

  test("one failing store never suppresses the other two deletions", async () => {
    const { deleteLssSession } = await import("./cache-cleanup");
    mockCanonicalDelete.mockRejectedValueOnce(new Error("canonical blocked"));
    await expect(deleteLssSession("previous-tab-session")).rejects.toThrow("1 store");
    expect(mockScratchDelete).toHaveBeenCalledWith("previous-tab-session");
    expect(mockFlowDelete).toHaveBeenCalledWith("previous-tab-session");
  });
});
