import {
  detectStackInputBits,
  formatStackBytes,
  formatStackBytesExact,
  formatStackDuration,
  formatStackInfoText,
  type LocalStackStudioInfoReport,
} from "./info-report";

describe("user-facing stack info", () => {
  test("shows exact byte sizes alongside human-readable units", () => {
    expect(formatStackBytes(1024)).toBe("1.00 KiB");
    expect(formatStackBytesExact(1024)).toBe("1.00 KiB (1,024 bytes)");
    expect(formatStackBytes(null)).toBe("Not available");
    expect(formatStackDuration(1642)).toBe("1.64 s");
  });

  test("reads PNG bit depth without decoding its image", () => {
    const png = new ArrayBuffer(32);
    const view = new DataView(png);
    view.setUint32(0, 0x89504e47, false);
    view.setUint32(4, 0x0d0a1a0a, false);
    view.setUint8(24, 16);
    expect(detectStackInputBits("photo.png", "image/png", png)).toBe(16);
    expect(detectStackInputBits("photo.png", "image/png", new ArrayBuffer(8))).toBeNull();
  });

  test("uses TIFF metadata and avoids inferring a RAW depth", () => {
    expect(detectStackInputBits("a.tif", "image/tiff", new ArrayBuffer(0), 16)).toBe(16);
    expect(detectStackInputBits("a.tif", "image/tiff", new ArrayBuffer(0))).toBeNull();
    expect(detectStackInputBits("a.cr3", "", new ArrayBuffer(0))).toBeNull();
  });

  test("reports unencoded output as unknown rather than guessing", () => {
    const report: LocalStackStudioInfoReport = {
      inputs: [{ fileName: "a.tif", bytes: 1024, format: "TIFF", width: 10, height: 10, bitsPerChannel: 16, fNumber: 8, exposureTime: null, iso: null }],
      settings: [{ label: "Blur", value: "none" }], mergeMode: "STF", alignmentMode: "Auto", actualAlignmentMode: "ECC",
      referenceFileName: "a.tif", totalMs: 2345, timings: [{ label: "Merge", durationMs: 1024 }],
      resultWidth: 10, resultHeight: 10, outputColorSpace: "sRGB", outputFormat: "JPEG",
      outputWidth: 10, outputHeight: 10, outputBitsPerChannel: 8, encodedBytes: null,
      retainedOutputBufferBytes: 800, alignmentFrameCacheBytes: 0, canonicalChunkCacheBytes: 0, canonicalCachePayloadBytes: 600, pageJsHeapBytes: null, warnings: [],
    };
    const content = formatStackInfoText(report);
    expect(content).toContain("Not encoded yet");
    expect(content).toContain("1,024 bytes");
    expect(content).toContain("Alignment: Auto (actual: ECC)");
    expect(content).toContain("not a total or peak");
  });
});
