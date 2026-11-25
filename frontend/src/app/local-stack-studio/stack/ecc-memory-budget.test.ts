import { chooseEcc16WorkerCount, isEccOutOfMemoryError } from "./ecc-memory-budget";

describe("16MP ECC bounded concurrency", () => {
  test("uses at most four workers and never more than jobs or CPUs", () => {
    expect(chooseEcc16WorkerCount({ jobCount: 15, hardwareConcurrency: 16, deviceMemoryGiB: 16, proxyBytes: 240_000_000 })).toBe(4);
    expect(chooseEcc16WorkerCount({ jobCount: 3, hardwareConcurrency: 16, deviceMemoryGiB: 16 })).toBe(3);
    expect(chooseEcc16WorkerCount({ jobCount: 15, hardwareConcurrency: 2, deviceMemoryGiB: 16 })).toBe(2);
    expect(chooseEcc16WorkerCount({ jobCount: 0, hardwareConcurrency: 16, deviceMemoryGiB: 16 })).toBe(0);
  });

  test("budgets worker memory and accounts for retained proxy frames", () => {
    expect(chooseEcc16WorkerCount({ jobCount: 14, hardwareConcurrency: 8, deviceMemoryGiB: 8, proxyBytes: 240_000_000 })).toBe(4);
    expect(chooseEcc16WorkerCount({ jobCount: 14, hardwareConcurrency: 8, deviceMemoryGiB: 4, proxyBytes: 240_000_000 })).toBe(1);
    expect(chooseEcc16WorkerCount({ jobCount: 14, hardwareConcurrency: 8, deviceMemoryGiB: 8, proxyBytes: 3_000_000_000 })).toBe(2);
    expect(chooseEcc16WorkerCount({ jobCount: 14, hardwareConcurrency: 8, deviceMemoryGiB: undefined })).toBe(2);
  });

  test("only recognizes actual memory failures", () => {
    expect(isEccOutOfMemoryError(new Error("OpenCV: (-4:Insufficient memory) Failed to allocate 384005184 bytes in function 'OutOfMemoryError'"))).toBe(true);
    expect(isEccOutOfMemoryError("Cannot enlarge memory arrays to size 2345678901 bytes")).toBe(true);
    expect(isEccOutOfMemoryError(new Error("ECC correlation is too low"))).toBe(false);
    expect(isEccOutOfMemoryError(new Error("Invalid ECC target grayscale buffer size: 0"))).toBe(false);
  });
});
