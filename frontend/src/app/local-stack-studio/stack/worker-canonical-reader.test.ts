const close = jest.fn();
const readLinearRegion = jest.fn(async () => new Float32Array([1, 2, 3]));
const readGamma2Region = jest.fn(async () => new Uint16Array([4, 5, 6]));
const openCanonicalReadSession = jest.fn();

jest.mock("./canonical-source", () => ({
  CANONICAL_WORKER_CACHE_BYTES: 32 * 1024 * 1024,
  openCanonicalReadSession: (...args: unknown[]) => openCanonicalReadSession(...args),
}));

jest.mock("./aligned-reader", () => ({
  AlignedImageReader: jest.fn().mockImplementation(() => ({
    width: 10,
    height: 20,
    readLinearRegion,
    readGamma2Region,
  })),
}));

import { WorkerCanonicalReader } from "./worker-canonical-reader";

describe("WorkerCanonicalReader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    openCanonicalReadSession.mockResolvedValue({
      id: "session",
      images: [{}, {}],
      chunkCache: { sizeBytes: 123, sizeEntries: 2 },
      close,
    });
  });

  test("opens a canonical session with the bounded worker cache and exposes aligned reads", async () => {
    const matrices = [null, null];
    const reader = await WorkerCanonicalReader.open({
      sessionId: "session",
      alignmentPlan: { normalizationMode: "feature-match", targetWidth: 10, targetHeight: 20 },
      matrices,
    });
    expect(openCanonicalReadSession).toHaveBeenCalledWith("session", 32 * 1024 * 1024);
    await expect(reader.readLinearRegion(0, 0, 0, 1, 1)).resolves.toEqual(new Float32Array([1, 2, 3]));
    await expect(reader.readGamma2Region(1, 0, 0, 1, 1, 4)).resolves.toEqual(new Uint16Array([4, 5, 6]));
    expect(reader.cacheBytes).toBe(123);
    expect(reader.cacheEntries).toBe(2);
    reader.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("rejects a matrix count that does not match the canonical session", async () => {
    await expect(WorkerCanonicalReader.open({
      sessionId: "session",
      alignmentPlan: { normalizationMode: "feature-match", targetWidth: 10, targetHeight: 20 },
      matrices: [null],
    })).rejects.toThrow("does not match canonical image count");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("custom worker cache limits are forwarded", async () => {
    const reader = await WorkerCanonicalReader.open({
      sessionId: "session",
      alignmentPlan: { normalizationMode: "feature-match", targetWidth: 10, targetHeight: 20 },
      matrices: [null, null],
      cacheBytes: 12 * 1024 * 1024,
    });
    expect(openCanonicalReadSession).toHaveBeenCalledWith("session", 12 * 1024 * 1024);
    reader.close();
  });

  test("reads fail after close", async () => {
    const reader = await WorkerCanonicalReader.open({
      sessionId: "session",
      alignmentPlan: { normalizationMode: "feature-match", targetWidth: 10, targetHeight: 20 },
      matrices: [null, null],
    });
    reader.close();
    expect(() => reader.readLinearRegion(0, 0, 0, 1, 1)).toThrow("closed");
  });
});
