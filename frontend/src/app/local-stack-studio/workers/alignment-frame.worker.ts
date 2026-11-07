// Generates alignment frames directly from canonical IndexedDB chunks, avoiding
// transfers of full-resolution RGB data through the main thread.
import { convertLinearProPhotoToOutputRgbInto } from "../../../image/color";
import { srgbChannelToLinear } from "../../../image/tone";
import { openCanonicalReadSession, readCanonicalLinearRowsLowMemory, type CanonicalReadSession } from "../stack/canonical-source";
import { loadWorkerOpenCv, type OpenCvDynamic, type OpenCvRuntime } from "./opencv-runtime";

type Request = { type: "init"; requestId: number; sessionId: string } | {
  type: "frame"; requestId: number; imageIndex: number; targetWidth: number;
  targetHeight: number; normalizationMode: string; exposureScalar: number | null;
  maxArea: number;
};
type Scope = { onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void };
const scope = globalThis as unknown as Scope;
let session: CanonicalReadSession | null = null;
let cv: OpenCvRuntime;
const lut = new Uint8Array(16385);
for (let i = 0; i < lut.length; i++) {
  const x = i / 16384;
  const encoded = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  lut[i] = Math.min(255, Math.max(0, Math.round(encoded * 255)));
}
function byte(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x >= 1) return 255;
  return lut[Math.round(x * 16384)];
}
function dimensions(width: number, height: number, maxArea: number) {
  if (width * height <= maxArea) return { width, height };
  const scale = Math.sqrt(maxArea / (width * height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
function normalize(linear: Float32Array, width: number, height: number, targetWidth: number, targetHeight: number, mode: string) {
  if (mode === "feature-match" || (width === targetWidth && height === targetHeight)) return linear;
  if (mode === "center-crop") {
    if (targetWidth > width || targetHeight > height) throw new Error("Invalid center-crop dimensions.");
    const dx = Math.floor((width - targetWidth) / 2), dy = Math.floor((height - targetHeight) / 2);
    const out = new Float32Array(targetWidth * targetHeight * 3);
    for (let y = 0; y < targetHeight; y++) out.set(linear.subarray(((dy + y) * width + dx) * 3, ((dy + y) * width + dx + targetWidth) * 3), y * targetWidth * 3);
    return out;
  }
  if (mode === "center-fill" || mode === "top-left-fill") {
    if (width > targetWidth || height > targetHeight) throw new Error("Invalid alignment fill dimensions.");
    const dx = mode === "center-fill" ? Math.floor((targetWidth - width) / 2) : 0;
    const dy = mode === "center-fill" ? Math.floor((targetHeight - height) / 2) : 0;
    const out = new Float32Array(targetWidth * targetHeight * 3);
    out.fill(srgbChannelToLinear(128));
    for (let y = 0; y < height; y++) out.set(linear.subarray(y * width * 3, (y + 1) * width * 3), ((dy + y) * targetWidth + dx) * 3);
    return out;
  }
  if (mode === "center-fit") {
    const source = new cv.Mat(height, width, cv.CV_32FC3);
    let resized: OpenCvDynamic = null;
    try {
      source.data32F.set(linear);
      const scale = Math.max(targetWidth / width, targetHeight / height);
      const resizedWidth = Math.max(targetWidth, Math.round(width * scale));
      const resizedHeight = Math.max(targetHeight, Math.round(height * scale));
      resized = new cv.Mat();
      cv.resize(source, resized, new cv.Size(resizedWidth, resizedHeight), 0, 0, cv.INTER_LINEAR);
      // Native Mat.clone() duplicates a handle rather than the pixels. Copy
      // the centered ROI from the typed view into a standalone array instead.
      const left = Math.floor((resizedWidth - targetWidth) / 2);
      const top = Math.floor((resizedHeight - targetHeight) / 2);
      const pixels = resized.data32F as Float32Array;
      const cropped = new Float32Array(targetWidth * targetHeight * 3);
      for (let y = 0; y < targetHeight; y += 1) {
        const offset = ((y + top) * resizedWidth + left) * 3;
        cropped.set(pixels.subarray(offset, offset + targetWidth * 3), y * targetWidth * 3);
      }
      return cropped;
    } finally { resized?.delete(); source.delete(); }
  }
  throw new Error(`Unsupported alignment normalization: ${mode}`);
}
async function generate(message: Extract<Request, { type: "frame" }>) {
  if (!session || !cv) throw new Error("Alignment frame worker is not initialized.");
  const meta = session.images[message.imageIndex];
  if (!meta) throw new Error("Unknown canonical image index.");
  const start = performance.now();
  const linear = await readCanonicalLinearRowsLowMemory(session, message.imageIndex, 0, meta.height);
  const readMs = performance.now() - start;
  const normStart = performance.now();
  const normalized = normalize(linear, meta.width, meta.height, message.targetWidth, message.targetHeight, message.normalizationMode);
  const normMs = performance.now() - normStart;
  const width = message.normalizationMode === "feature-match" ? meta.width : message.targetWidth;
  const height = message.normalizationMode === "feature-match" ? meta.height : message.targetHeight;
  if (normalized.length !== width * height * 3) throw new Error("Invalid normalized alignment RGB buffer size.");
  const rgba = new cv.Mat(height, width, cv.CV_8UC4);
  try {
    const convertStart = performance.now();
    // The converter can trigger WASM heap growth, invalidating old Mat.data
    // views. Complete each stripe in JavaScript memory before copying to a
    // freshly acquired Mat view.
    const pixelCount = width * height;
    const expectedLength = pixelCount * 4;
    // Convert one bounded stripe at a time. Keep RGBA bytes off the WASM
    // heap until each stripe is complete, then reacquire the heap view before
    // writing it. This preserves the Phase 2 fix without allocating a second
    // full-resolution RGBA image (roughly 80 MiB for a 20MP input).
    const stripeRows = Math.min(height, 128);
    const stripeBytes = new Uint8Array(width * stripeRows * 4);
    const converted = new Float32Array(3);
    for (let y = 0; y < height; y += stripeRows) {
      const rows = Math.min(stripeRows, height - y);
      const count = rows * width;
      const sourcePixel = y * width;
      for (let pixel = 0; pixel < count; pixel++) {
        const src = (sourcePixel + pixel) * 3;
        const dst = pixel * 4;
        convertLinearProPhotoToOutputRgbInto(normalized[src], normalized[src + 1], normalized[src + 2], "srgb", converted);
        stripeBytes[dst] = byte(converted[0]);
        stripeBytes[dst + 1] = byte(converted[1]);
        stripeBytes[dst + 2] = byte(converted[2]);
        stripeBytes[dst + 3] = 255;
      }
      // The color converter may cause WASM heap growth. Never retain a
      // Mat.data view across calls to it.
      const dstBytes: Uint8Array = rgba.data;
      if (dstBytes.length !== expectedLength) throw new Error("Alignment RGBA heap view changed size.");
      dstBytes.set(stripeBytes.subarray(0, count * 4), sourcePixel * 4);
    }
    const finalBytes: Uint8Array = rgba.data;
    if (rgba.channels() !== 4 || finalBytes.length !== expectedLength) throw new Error("Invalid alignment RGBA Mat size or channels.");
    if (finalBytes[expectedLength - 1] !== 255) {
      throw new Error("Alignment RGBA conversion did not populate the final pixel.");
    }
    const colorConversionMs = performance.now() - convertStart;
    const size = dimensions(width, height, message.maxArea);
    const resized = size.width === width && size.height === height ? null : new cv.Mat();
    const gray = new cv.Mat();
    try {
      const resizeStart = performance.now();
      if (resized) cv.resize(rgba, resized, new cv.Size(size.width, size.height), 0, 0, cv.INTER_AREA);
      const resizeMs = performance.now() - resizeStart;
      const grayStart = performance.now();
      cv.cvtColor(resized || rgba, gray, cv.COLOR_RGBA2GRAY);
      const grayBytes = new Uint8Array(gray.data.subarray(0, size.width * size.height));
      const grayMs = performance.now() - grayStart;
      return { width: size.width, height: size.height, fullWidth: width, fullHeight: height,
        exposureScalar: message.exposureScalar, grayBytes, readMs, normMs, colorConversionMs,
        resizeMs, grayMs, totalMs: performance.now() - start };
    } finally { resized?.delete(); gray.delete(); }
  } finally { rgba.delete(); }
}
scope.onmessage = (event) => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === "init") {
        cv = await loadWorkerOpenCv("alignment frame");
        session?.close();
        session = await openCanonicalReadSession(message.sessionId);
        scope.postMessage({ type: "ready", requestId: message.requestId });
      } else {
        const result = await generate(message);
        scope.postMessage({ type: "frame", requestId: message.requestId, ...result,
          grayBuffer: result.grayBytes.buffer }, [result.grayBytes.buffer as ArrayBuffer]);
      }
    } catch (error) {
      scope.postMessage({ type: "error", requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
