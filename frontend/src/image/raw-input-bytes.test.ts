import { readRawInputBytes, releaseRawInputBytes } from "./raw-input-bytes";

type FakeRawFile = File & { arrayBuffer: jest.Mock<Promise<ArrayBuffer>, []> };

function createRawFile(bytes: number[]): FakeRawFile {
  const buffer = new Uint8Array(bytes);
  return {
    size: buffer.byteLength,
    arrayBuffer: jest.fn(async () => buffer.slice().buffer as ArrayBuffer),
  } as unknown as FakeRawFile;
}

describe("bounded RAW source-byte reuse (LIS and LSS)", () => {
  test("reuses the file read across metadata and development without aliasing buffers", async () => {
    const file = createRawFile([1, 2, 3, 4]);
    try {
      const metadataInput = await readRawInputBytes(file);
      // A worker can consume, mutate or transfer this buffer.
      metadataInput[0] = 99;
      const developmentInput = await readRawInputBytes(file);
      expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
      expect(Array.from(developmentInput)).toEqual([1, 2, 3, 4]);
      expect(developmentInput.buffer).not.toBe(metadataInput.buffer);
    } finally {
      releaseRawInputBytes(file);
    }
  });

  test("coalesces concurrent first reads without sharing transferable buffers", async () => {
    const file = createRawFile([4, 5, 6]);
    try {
      const [first, second] = await Promise.all([
        readRawInputBytes(file),
        readRawInputBytes(file),
      ]);
      expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
      expect(Array.from(first)).toEqual([4, 5, 6]);
      expect(Array.from(second)).toEqual([4, 5, 6]);
      expect(first.buffer).not.toBe(second.buffer);
    } finally {
      releaseRawInputBytes(file);
    }
  });

  test("release prevents retaining RAW data beyond a processing session", async () => {
    const file = createRawFile([7, 8]);
    await readRawInputBytes(file);
    releaseRawInputBytes(file);
    await readRawInputBytes(file);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
    releaseRawInputBytes(file);
  });

  test("does not retain files larger than the memory budget", async () => {
    const file = {
      size: 64 * 1024 * 1024 + 1,
      arrayBuffer: jest.fn(async () => Uint8Array.of(1, 2).buffer),
    } as unknown as FakeRawFile;
    await readRawInputBytes(file);
    await readRawInputBytes(file);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
    releaseRawInputBytes(file);
  });

  test("expires retained input after one minute", async () => {
    jest.useFakeTimers();
    const file = createRawFile([9]);
    try {
      await readRawInputBytes(file);
      jest.advanceTimersByTime(60_000);
      await readRawInputBytes(file);
      expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
    } finally {
      releaseRawInputBytes(file);
      jest.useRealTimers();
    }
  });

  test("an unsuccessful read cannot leave a cached entry", async () => {
    const file = createRawFile([3]);
    file.arrayBuffer.mockRejectedValueOnce(new Error("read failed"));
    await expect(readRawInputBytes(file)).rejects.toThrow("read failed");
    expect(Array.from(await readRawInputBytes(file))).toEqual([3]);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(2);
    releaseRawInputBytes(file);
  });
});
