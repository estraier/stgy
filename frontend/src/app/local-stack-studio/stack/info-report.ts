/** User-facing summary of a completed Local Stack Studio operation. No debug data. */
export type StackInfoInput = {
  fileName: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
  bitsPerChannel: number | null;
  fNumber: number | null;
  exposureTime: number | null;
  iso: number | null;
};

export type StackInfoTiming = { label: string; durationMs: number; includedIn?: string };
export type StackInfoSetting = { label: string; value: string };
export type LocalStackStudioInfoReport = {
  inputs: StackInfoInput[];
  settings: StackInfoSetting[];
  mergeMode: string;
  alignmentMode: string;
  actualAlignmentMode: string;
  referenceFileName: string | null;
  totalMs: number;
  timings: StackInfoTiming[];
  resultWidth: number;
  resultHeight: number;
  outputColorSpace: string;
  outputFormat: string;
  outputWidth: number;
  outputHeight: number;
  outputBitsPerChannel: number;
  // Real encoded size is only known after a matching download/encode.
  encodedBytes: number | null;
  // Exact sizes of explicitly owned buffers; not total browser/worker memory.
  retainedOutputBufferBytes: number;
  alignmentFrameCacheBytes: number;
  canonicalChunkCacheBytes: number;
  canonicalCachePayloadBytes: number;
  pageJsHeapBytes: number | null;
  warnings: string[];
};

export function formatStackBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "Not available";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let count = bytes;
  let level = -1;
  do { count /= 1024; level += 1; } while (count >= 1024 && level < units.length - 1);
  return `${count.toFixed(count >= 10 ? 1 : 2)} ${units[level]}`;
}

export function formatStackBytesExact(bytes: number | null): string {
  return bytes === null ? "Not available" : `${formatStackBytes(bytes)} (${bytes.toLocaleString("en-US")} bytes)`;
}

export function formatStackDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Not available";
  if (milliseconds < 1000) return `${milliseconds.toFixed(0)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export function formatStackDimensions(width: number, height: number): string {
  return `${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")}`;
}

export function formatStackInfoText(report: LocalStackStudioInfoReport): string {
  const lines: string[] = [
    "Local Stack Studio — Image information",
    "",
    `Input: ${report.inputs.length} image${report.inputs.length === 1 ? "" : "s"}`,
  ];
  for (const input of report.inputs) {
    lines.push(`  ${input.fileName} — ${formatStackBytesExact(input.bytes)} · ${input.format} · ${formatStackDimensions(input.width, input.height)} · ${input.bitsPerChannel === null ? "Bit depth unknown" : `${input.bitsPerChannel} bits/channel`}`);
    const exposure = [
      input.fNumber === null ? null : `f/${input.fNumber}`,
      input.exposureTime === null ? null : `${input.exposureTime} s`,
      input.iso === null ? null : `ISO ${input.iso}`,
    ].filter(Boolean);
    if (exposure.length) lines.push(`    ${exposure.join(" · ")}`);
  }
  lines.push("", "Output:",
    `  Result: ${formatStackDimensions(report.resultWidth, report.resultHeight)}`,
    `  Selected export: ${report.outputFormat}, ${formatStackDimensions(report.outputWidth, report.outputHeight)}, ${report.outputBitsPerChannel} bits/channel`,
    `  Exported file size: ${report.encodedBytes === null ? "Not encoded yet" : formatStackBytesExact(report.encodedBytes)}`,
    `  Result RGB buffer: ${formatStackBytesExact(report.resultWidth * report.resultHeight * 3 * 2)}`,
    `  Color profile: ${report.outputColorSpace}`,
    "", "Processing:",
    `  Merge: ${report.mergeMode}`,
    `  Alignment: ${report.alignmentMode} (actual: ${report.actualAlignmentMode})`,
    `  Reference image: ${report.referenceFileName ?? "Not applicable"}`,
  );
  for (const setting of report.settings) lines.push(`  ${setting.label}: ${setting.value}`);
  lines.push("", `Total processing time: ${formatStackDuration(report.totalMs)}`, "Stages (elapsed wall time):");
  for (const timing of report.timings) lines.push(`  ${timing.label}: ${formatStackDuration(timing.durationMs)}${timing.includedIn ? ` (included in ${timing.includedIn})` : ""}`);
  lines.push("", "Memory and storage:",
    `  Retained output buffers: ${formatStackBytes(report.retainedOutputBufferBytes)}`,
    `  Alignment frame cache: ${formatStackBytes(report.alignmentFrameCacheBytes)}`,
    `  Canonical chunk memory cache: ${formatStackBytes(report.canonicalChunkCacheBytes)}`,
    `  Canonical cache payload (stored on disk): ${formatStackBytes(report.canonicalCachePayloadBytes)}`,
    `  Page JavaScript heap (sample): ${formatStackBytes(report.pageJsHeapBytes)}`,
    "  These are not a total or peak for the browser, workers, WASM and GPU.",
  );
  if (report.warnings.length) {
    lines.push("", "Notes:");
    for (const warning of report.warnings) lines.push(`  ${warning}`);
  }
  return lines.join("\n");
}

export function detectStackInputBits(fileName: string, fileType: string, data: ArrayBuffer, tiffBits?: number | null): number | null {
  const name = fileName.toLowerCase();
  if (/\.(tif|tiff)$/.test(name) || /tiff/i.test(fileType)) return tiffBits ?? null;
  if (/\.png$/.test(name) || /png/i.test(fileType)) {
    const view = new DataView(data);
    if (view.byteLength >= 26 && view.getUint32(0, false) === 0x89504e47 && view.getUint32(4, false) === 0x0d0a1a0a) {
      const depth = view.getUint8(24);
      return [1, 2, 4, 8, 16].includes(depth) ? depth : null;
    }
    return null;
  }
  if (/\.(jpe?g|webp)$/.test(name) || /jpeg|webp/i.test(fileType)) return 8;
  return null;
}
