/** Temporary Progressive ORB image-path diagnostics. No image data leaves the worker. */
export type AlignmentStageFingerprint = {
  width: number;
  height: number;
  channels: number;
  hashesByQuarter: string[];
  fullHash: string;
  probes: Array<{ x: number; y: number; values: number[] }>;
};

export function fingerprintAlignmentStage(
  data: Float32Array | Uint8Array, width: number, height: number, channels: number,
): AlignmentStageFingerprint {
  if (data.length !== width * height * channels) {
    throw new Error(`Fingerprint input length mismatch: ${width}x${height}x${channels}, length ${data.length}`);
  }
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const bytesPerSample = data.BYTES_PER_ELEMENT;
  const rowBytes = width * channels * bytesPerSample;
  const fnv = (start: number, end: number) => {
    let h = 2166136261;
    for (let i = start; i < end; i++) h = Math.imul(h ^ bytes[i], 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const bounds = [0, Math.floor(height / 4), Math.floor(height / 2),
    Math.floor(height * 3 / 4), height];
  const probeRows = Array.from(new Set([0, Math.max(0, bounds[3] - 1), bounds[3],
    Math.min(height - 1, bounds[3] + 1), height - 1])).filter((y) => y >= 0 && y < height);
  return {
    width, height, channels,
    fullHash: fnv(0, bytes.length),
    hashesByQuarter: bounds.slice(0, 4).map((row, i) => fnv(row * rowBytes, bounds[i + 1] * rowBytes)),
    probes: probeRows.map((y) => ({ x: 0, y,
      values: Array.from(data.subarray(y * width * channels, y * width * channels + channels)),
    })),
  };
}
