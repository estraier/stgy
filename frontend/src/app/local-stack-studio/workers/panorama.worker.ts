// Local Stack Studio panorama worker. Built to public/generated/local-stack-studio.
import {
  openCanonicalReadSession,
  readCanonicalLinearRows,
} from "../stack/canonical-source";
import {
  largestValidPanoramaRectFromMask,
  panoramaCoverageFromExteriorBlack,
} from "../stack/panorama-crop";
import { estimatePanoramaCompositingResolutionMpx } from "../stack/panorama-scale";
import { transferableBuffer } from "./transfer-buffer";
import type {
  PanoramaWorkerRequest,
  PanoramaWorkerResponse,
} from "./protocols/panorama-protocol";

(() => {
  "use strict";

  type WorkerScope = {
    onmessage: ((event: MessageEvent<PanoramaWorkerRequest>) => void | Promise<void>) | null;
    postMessage: (message: PanoramaWorkerResponse, transfer?: Transferable[]) => void;
  };

  type Deletable = { delete?: () => void; isDeleted?: () => boolean };
  type NativeMat = Deletable & {
    rows: number;
    cols: number;
    data: Uint8Array;
  };
  type NativeMatConstructor = new () => NativeMat;
  type NativeMatVector = Deletable;
  type NativeMatVectorConstructor = new () => NativeMatVector;
  type DynamicStitcher = Deletable & {
    stitch: (images: unknown, output: NativeMat) => number;
    component: () => unknown;
    setCompositingResol?: (resolutionMpx: number) => void;
    resultMask?: () => unknown;
  };
  type DynamicVector = Deletable & {
    size?: () => number;
    get?: (index: number) => unknown;
    push_back?: (value: unknown) => void;
  };

  const workerScope = globalThis as unknown as WorkerScope;
  const STITCHER_OK = 0;
  const INPUT_BYTE_MAX = 255;
  const STORED_UINT16_MAX = 65535;
  // @banou/opencv-wasm is built from OpenCV.js, whose WASM heap is capped at
  // 1 GiB. Keep a substantial margin for module/static data, allocator
  // fragmentation, feature matching, warping and the MultiBandBlender
  // pyramids used by Stitcher.
  const OPENCV_WASM_SAFE_BYTES = 768 * 1024 * 1024;
  const OPENCV_WASM_FIXED_RESERVE_BYTES = 96 * 1024 * 1024;
  const PANORAMA_BLEND_BYTES_PER_OUTPUT_PIXEL = 18;
  const PANORAMA_MIN_COMPOSITING_MPX = 0.1;
  const PANORAMA_PROBE_COMPOSITING_MPX = 0.5;
  const PANORAMA_RETRY_SCALE = 0.6;
  const PANORAMA_MAX_STITCH_ATTEMPTS = 3;
  const PANORAMA_MODULE_URL = "/vendor/opencv-stitching/lib/index.js";
  const PANORAMA_WASM_URL = "/vendor/opencv-stitching/lib/opencv_js.wasm";
  let openCvModulePromise: Promise<Record<string, unknown>> | null = null;
  let loadedOpenCvModule: Record<string, unknown> | null = null;
  let openCvRuntime: Record<string, unknown> | null = null;
  let initPromise: Promise<void> | null = null;
  let nativeApi: {
    Mat: NativeMatConstructor;
    MatVector: NativeMatVectorConstructor;
    CV_8UC3: number;
    matFromArray: (rows: number, cols: number, type: number, data: ArrayLike<number>) => NativeMat;
    createStitcher: () => DynamicStitcher;
  } | null = null;

  workerScope.onmessage = async (event: MessageEvent<PanoramaWorkerRequest>) => {
    const message = event.data;
    const requestId = message.requestId;
    try {
      if (message.type !== "stitch") throw new Error(`Unsupported panorama worker request: ${String((message as { type?: unknown }).type)}`);
      const result = await stitchCanonicalPanorama(
        requestId,
        message.sessionId,
        message.cacheBytes,
        message.maxOutputMegapixels ?? null,
      );
      const gamma2Buffer = transferableBuffer(result.gamma2Rgb);
      workerScope.postMessage(
        {
          type: "result",
          requestId,
          width: result.width,
          height: result.height,
          gamma2Buffer,
        },
        [gamma2Buffer],
      );
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId,
        message: describeOpenCvError(error),
      });
    }
  };

  async function loadOpenCvModule(): Promise<Record<string, unknown>> {
    if (!openCvModulePromise) {
      // Keep the OpenCV package out of the esbuild worker bundle. The package's
      // Emscripten loader contains a Node-only dynamic import("module") branch,
      // which esbuild tries to resolve even for a browser bundle. The package
      // explicitly supports serving lib/ intact and importing lib/index.js.
      openCvModulePromise = import(PANORAMA_MODULE_URL) as Promise<Record<string, unknown>>;
    }
    return openCvModulePromise;
  }

  async function ensureOpenCv(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        const openCvModule = await loadOpenCvModule();
        loadedOpenCvModule = openCvModule;
        const initOpenCV = openCvModule.initOpenCV;
        if (typeof initOpenCV !== "function") {
          throw new Error("Panorama OpenCV build does not expose initOpenCV().");
        }
        const initialized = await (initOpenCV as (options: { wasmUrl: string }) => Promise<unknown>)({
          wasmUrl: PANORAMA_WASM_URL,
        });
        if (initialized && typeof initialized === "object") {
          openCvRuntime = initialized as Record<string, unknown>;
        }
        nativeApi = resolveNativeApi(openCvModule);
      })();
    }
    await initPromise;
  }

  function resolveNativeApi(openCvModule: Record<string, unknown>): NonNullable<typeof nativeApi> {
    const MatClass = openCvModule.Mat;
    const MatVectorClass = openCvModule.MatVector;
    const matFromArrayFunction = openCvModule.matFromArray;
    const cv8uc3 = Number(openCvModule.CV_8UC3);
    if (typeof MatClass !== "function" || typeof MatVectorClass !== "function" || typeof matFromArrayFunction !== "function" || !Number.isFinite(cv8uc3)) {
      throw new Error("Panorama OpenCV build is missing required matrix APIs.");
    }

    const StitcherClass = openCvModule.Stitcher as { create?: (mode?: number) => unknown } | undefined;
    const flatFactory = openCvModule.Stitcher_create;
    const panoramaMode = Number(openCvModule.Stitcher_PANORAMA ?? 0);
    const createStitcher = (): DynamicStitcher => {
      let created: unknown = null;
      if (StitcherClass && typeof StitcherClass.create === "function") {
        created = StitcherClass.create(panoramaMode);
      } else if (typeof flatFactory === "function") {
        created = (flatFactory as (mode?: number) => unknown)(panoramaMode);
      }
      if (!created || typeof created !== "object") {
        throw new Error("Panorama OpenCV build does not expose the Stitcher factory.");
      }
      const stitcher = created as DynamicStitcher;
      if (typeof stitcher.stitch !== "function" || typeof stitcher.component !== "function") {
        deleteNative(stitcher);
        throw new Error("Panorama OpenCV Stitcher is missing required methods.");
      }
      return stitcher;
    };

    return {
      Mat: MatClass as NativeMatConstructor,
      MatVector: MatVectorClass as NativeMatVectorConstructor,
      CV_8UC3: cv8uc3,
      matFromArray: matFromArrayFunction as NonNullable<typeof nativeApi>["matFromArray"],
      createStitcher,
    };
  }

  function getNativeApi(): NonNullable<typeof nativeApi> {
    if (!nativeApi) throw new Error("Panorama OpenCV is not initialized.");
    return nativeApi;
  }

  function describeOpenCvError(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (typeof error === "number" && Number.isFinite(error)) {
      const decoded = decodeNativeException(error);
      if (decoded) return `Panorama OpenCV error: ${decoded}`;
      return `Panorama OpenCV threw a native C++ exception (pointer ${error}).`;
    }

    if (error && typeof error === "object") {
      const item = error as Record<string, unknown>;
      const message = firstNonEmptyString(item.message, item.msg, item.what);
      const code = typeof item.code === "number" ? item.code : null;
      if (message && code !== null) return `Panorama OpenCV error ${code}: ${message}`;
      if (message) return message;
    }

    return String(error);
  }

  function firstNonEmptyString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  }

  function exceptionSources(): Record<string, unknown>[] {
    const sources: Record<string, unknown>[] = [];
    const append = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (!sources.includes(record)) sources.push(record);
      const nested = record.Module;
      if (nested && typeof nested === "object" && !sources.includes(nested as Record<string, unknown>)) {
        sources.push(nested as Record<string, unknown>);
      }
    };
    append(openCvRuntime);
    append(loadedOpenCvModule);
    return sources;
  }

  function decodeNativeException(pointer: number): string | null {
    for (const source of exceptionSources()) {
      const exceptionFromPtr = source.exceptionFromPtr;
      if (typeof exceptionFromPtr === "function") {
        try {
          const exception = (exceptionFromPtr as (value: number) => unknown)(pointer);
          if (exception && typeof exception === "object") {
            const item = exception as Record<string, unknown>;
            const message = firstNonEmptyString(item.msg, item.message, item.what);
            const code = typeof item.code === "number" ? item.code : null;
            const file = firstNonEmptyString(item.file);
            const func = firstNonEmptyString(item.func);
            const line = typeof item.line === "number" ? item.line : null;
            const locationParts = [
              file,
              line !== null ? `line ${line}` : null,
              func,
            ].filter((value): value is string => Boolean(value));
            const location = locationParts.length ? ` (${locationParts.join(", ")})` : "";
            if (message && code !== null) return `OpenCV(${code}): ${message}${location}`;
            if (message) return `${message}${location}`;
          }
        } catch {
          // Try Emscripten's generic exception decoder below.
        }
      }

      const getExceptionMessage = source.getExceptionMessage;
      if (typeof getExceptionMessage === "function") {
        try {
          const decoded = (getExceptionMessage as (value: number) => unknown)(pointer);
          if (Array.isArray(decoded)) {
            const type = firstNonEmptyString(decoded[0]);
            const message = firstNonEmptyString(decoded[1]);
            if (type && message) return `${type}: ${message}`;
            if (message) return message;
            if (type) return type;
          }
          const message = firstNonEmptyString(decoded);
          if (message) return message;
        } catch {
          // This helper is optional and differs between Emscripten builds.
        }
      }
    }
    return null;
  }

  function postProgress(requestId: number, message: string): void {
    workerScope.postMessage({ type: "progress", requestId, message });
  }

  function deleteNative(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const item = value as Deletable;
    if (typeof item.delete !== "function") return;
    if (typeof item.isDeleted === "function" && item.isDeleted()) return;
    item.delete();
  }

  function statusMessage(status: number): string {
    switch (status) {
      case 1: return "not enough overlapping images";
      case 2: return "homography estimation failed";
      case 3: return "camera parameter adjustment failed";
      default: return `status ${status}`;
    }
  }

  function vectorLength(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (ArrayBuffer.isView(value)) {
      const length = Number((value as unknown as { length?: unknown }).length);
      if (Number.isInteger(length) && length >= 0) return length;
    }
    if (value && typeof value === "object") {
      const vector = value as DynamicVector;
      if (typeof vector.size === "function") return Number(vector.size());
      const length = Number((value as { length?: unknown }).length);
      if (Number.isInteger(length) && length >= 0) return length;
    }
    throw new Error("Panorama Stitcher returned an unreadable component list.");
  }

  function createMatVector(images: NativeMat[]): NativeMatVector {
    const MatVectorClass = getNativeApi().MatVector;
    const vector = new MatVectorClass();
    const dynamic = vector as unknown as DynamicVector;
    if (typeof dynamic.push_back !== "function") {
      deleteNative(vector);
      throw new Error("Panorama OpenCV build does not expose MatVector.push_back().");
    }
    for (const image of images) dynamic.push_back(image);
    return vector;
  }

  function tryReadResultMask(stitcher: DynamicStitcher): NativeMat | null {
    if (typeof stitcher.resultMask !== "function") return null;
    try {
      const value = stitcher.resultMask();
      if (!value || typeof value !== "object") return null;
      const mask = value as NativeMat;
      if (!Number.isInteger(mask.rows) || !Number.isInteger(mask.cols) || !(mask.data instanceof Uint8Array)) {
        deleteNative(mask);
        return null;
      }
      return mask;
    } catch {
      return null;
    }
  }

  function panoramaCompositingResolutionMpx(
    images: ReadonlyArray<{ width: number; height: number }>,
  ): number {
    if (images.length === 0) return -1;
    let inputPixels = 0;
    for (const image of images) {
      inputPixels += Math.max(0, image.width) * Math.max(0, image.height);
    }
    const referenceInputPixels = Math.max(0, images[0]!.width) * Math.max(0, images[0]!.height);
    if (referenceInputPixels <= 0) return -1;

    // OpenCV expresses compositingResol as megapixels of the first/reference
    // input. The input CV_8UC3 Mats remain resident while Stitcher composes,
    // so budget them first and reserve the rest for warped images and the
    // MultiBandBlender pyramids.
    const inputBytes = inputPixels * 3;
    const availableForComposition = Math.max(
      PANORAMA_MIN_COMPOSITING_MPX * 1e6 * PANORAMA_BLEND_BYTES_PER_OUTPUT_PIXEL,
      OPENCV_WASM_SAFE_BYTES - OPENCV_WASM_FIXED_RESERVE_BYTES - inputBytes,
    );
    const estimatedPanoramaAreaFactor = Math.max(1, images.length * 0.8);
    const referencePixelBudget =
      availableForComposition
      / PANORAMA_BLEND_BYTES_PER_OUTPUT_PIXEL
      / estimatedPanoramaAreaFactor;
    const requestedMpx = Math.max(
      PANORAMA_MIN_COMPOSITING_MPX,
      referencePixelBudget / 1e6,
    );
    const referenceInputMpx = referenceInputPixels / 1e6;

    if (requestedMpx >= referenceInputMpx * 0.98) return -1;
    return Math.min(referenceInputMpx, requestedMpx);
  }

  function tighterCompositingResolution(
    first: number,
    second: number,
  ): number {
    if (first < 0) return second;
    if (second < 0) return first;
    return Math.min(first, second);
  }

  function validateMaxOutputMegapixels(value: number | null): number | null {
    if (value === null) return null;
    if (![4, 8, 16, 32, 64].includes(value)) {
      throw new Error(`Unsupported Panorama downscale: ${String(value)}MP.`);
    }
    return value;
  }

  function setPanoramaCompositingResolution(
    stitcher: DynamicStitcher,
    resolutionMpx: number,
  ): void {
    if (resolutionMpx < 0) return;
    if (typeof stitcher.setCompositingResol !== "function") {
      throw new Error(
        "Panorama OpenCV build does not expose Stitcher.setCompositingResol(), "
        + "which is required to stay within the 1 GiB WASM memory limit.",
      );
    }
    stitcher.setCompositingResol(resolutionMpx);
  }

  function isOpenCvAllocationFailure(error: unknown): boolean {
    const message = describeOpenCvError(error).toLowerCase();
    return (message.includes("umatrix.cpp") && message.includes("u != 0"))
      || message.includes("outofmemory")
      || message.includes("out of memory")
      || message.includes("cannot enlarge memory")
      || message.includes("memory access out of bounds");
  }

  async function loadCanonicalBgrMat(
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    imageIndex: number,
  ): Promise<NativeMat> {
    const meta = session.images[imageIndex];
    if (!meta) throw new Error(`Canonical panorama input ${imageIndex + 1} is unavailable.`);
    const bgr = new Uint8Array(meta.width * meta.height * 3);
    const rowsPerRead = 128;
    for (let startRow = 0; startRow < meta.height; startRow += rowsPerRead) {
      const rowCount = Math.min(rowsPerRead, meta.height - startRow);
      const linearRgb = await readCanonicalLinearRows(session, imageIndex, startRow, rowCount);
      let destination = startRow * meta.width * 3;
      for (let source = 0; source < linearRgb.length; source += 3, destination += 3) {
        const r = Math.min(1, Math.max(0, linearRgb[source] ?? 0));
        const g = Math.min(1, Math.max(0, linearRgb[source + 1] ?? 0));
        const b = Math.min(1, Math.max(0, linearRgb[source + 2] ?? 0));
        // Match the standalone Python implementation: clip linear RGB to 0..1,
        // multiply by 255, then truncate to uint8 before handing it to Stitcher.
        bgr[destination] = Math.floor(b * INPUT_BYTE_MAX);
        bgr[destination + 1] = Math.floor(g * INPUT_BYTE_MAX);
        bgr[destination + 2] = Math.floor(r * INPUT_BYTE_MAX);
      }
    }
    const api = getNativeApi();
    return api.matFromArray(meta.height, meta.width, api.CV_8UC3, bgr);
  }

  function panoramaCropForStitchedImage(
    stitcher: DynamicStitcher,
    panorama: NativeMat,
  ): ReturnType<typeof largestValidPanoramaRectFromMask> {
    const panoramaWidth = Number(panorama.cols);
    const panoramaHeight = Number(panorama.rows);
    if (
      !Number.isInteger(panoramaWidth)
      || !Number.isInteger(panoramaHeight)
      || panoramaWidth <= 0
      || panoramaHeight <= 0
    ) {
      throw new Error("Panorama Stitcher returned invalid output dimensions.");
    }

    let resultMask: NativeMat | null = null;
    try {
      resultMask = tryReadResultMask(stitcher);
      if (
        resultMask
        && Number(resultMask.cols) === panoramaWidth
        && Number(resultMask.rows) === panoramaHeight
        && resultMask.data.length === panoramaWidth * panoramaHeight
      ) {
        const crop = largestValidPanoramaRectFromMask(
          resultMask.data.slice(),
          panoramaWidth,
          panoramaHeight,
        );
        if (crop) return crop;
      }
    } finally {
      deleteNative(resultMask);
    }

    const fallbackCoverage = panoramaCoverageFromExteriorBlack(
      panorama.data,
      panoramaWidth,
      panoramaHeight,
    );
    return largestValidPanoramaRectFromMask(
      fallbackCoverage,
      panoramaWidth,
      panoramaHeight,
    );
  }

  function assertAllPanoramaInputsConnected(
    stitcher: DynamicStitcher,
    expectedCount: number,
  ): void {
    let component: unknown = null;
    try {
      component = stitcher.component();
      const componentCount = vectorLength(component);
      if (componentCount !== expectedCount) {
        throw new Error(
          `Panorama could connect only ${componentCount} of ${expectedCount} input images.`,
        );
      }
    } finally {
      deleteNative(component);
    }
  }

  function encodeCroppedPanorama(
    panoramaBgr: Uint8Array,
    panoramaWidth: number,
    panoramaHeight: number,
    crop: { x: number; y: number; width: number; height: number },
  ): { width: number; height: number; gamma2Rgb: Uint16Array } {
    if (panoramaBgr.length !== panoramaWidth * panoramaHeight * 3) {
      throw new Error("Panorama Stitcher returned an unexpected pixel buffer.");
    }

    // Do not resize after stitching. Downscale controls Stitcher's composition
    // resolution to reduce memory use, but the final cropped pixels are kept
    // exactly as produced by Stitcher even when the resulting pixel count is
    // somewhat above the selected estimate.
    const output = new Uint16Array(crop.width * crop.height * 3);
    let destination = 0;
    for (let y = 0; y < crop.height; y += 1) {
      let source = ((crop.y + y) * panoramaWidth + crop.x) * 3;
      for (let x = 0; x < crop.width; x += 1, source += 3, destination += 3) {
        const b = panoramaBgr[source]! / INPUT_BYTE_MAX;
        const g = panoramaBgr[source + 1]! / INPUT_BYTE_MAX;
        const r = panoramaBgr[source + 2]! / INPUT_BYTE_MAX;
        output[destination] = Math.round(Math.sqrt(Math.max(0, r)) * STORED_UINT16_MAX);
        output[destination + 1] = Math.round(Math.sqrt(Math.max(0, g)) * STORED_UINT16_MAX);
        output[destination + 2] = Math.round(Math.sqrt(Math.max(0, b)) * STORED_UINT16_MAX);
      }
    }
    return { width: crop.width, height: crop.height, gamma2Rgb: output };
  }

  async function stitchCanonicalPanorama(
    requestId: number,
    sessionId: string,
    cacheBytes?: number,
    requestedMaxOutputMegapixels: number | null = null,
  ): Promise<{ width: number; height: number; gamma2Rgb: Uint16Array }> {
    if (!sessionId) throw new Error("Panorama canonical session id is required.");
    const maxOutputMegapixels = validateMaxOutputMegapixels(
      requestedMaxOutputMegapixels,
    );
    const maxOutputPixels = maxOutputMegapixels === null
      ? null
      : maxOutputMegapixels * 1_000_000;

    postProgress(requestId, "Loading panorama OpenCV...");
    await ensureOpenCv();

    const session = await openCanonicalReadSession(sessionId, cacheBytes);
    const images: NativeMat[] = [];
    let imageVector: NativeMatVector | null = null;
    let stitcher: DynamicStitcher | null = null;
    let panorama: NativeMat | null = null;

    try {
      if (session.images.length < 2) throw new Error("Panorama requires at least two input images.");

      for (let index = 0; index < session.images.length; index += 1) {
        postProgress(requestId, `Preparing panorama input ${index + 1}/${session.images.length}...`);
        images.push(await loadCanonicalBgrMat(session, index));
      }
      imageVector = createMatVector(images);

      const MatClass = getNativeApi().Mat;
      const memorySafeCompositingMpx = panoramaCompositingResolutionMpx(session.images);
      let userCompositingResolutionMpx = -1;

      if (maxOutputPixels !== null) {
        let probeResolutionMpx = tighterCompositingResolution(
          PANORAMA_PROBE_COMPOSITING_MPX,
          memorySafeCompositingMpx,
        );
        let probeComplete = false;
        for (let attempt = 0; attempt < PANORAMA_MAX_STITCH_ATTEMPTS; attempt += 1) {
          let probeStitcher: DynamicStitcher | null = null;
          let probePanorama: NativeMat | null = null;
          try {
            postProgress(
              requestId,
              attempt === 0
                ? `Estimating panorama size for about ${maxOutputMegapixels}MP...`
                : `Retrying panorama size estimate at ${probeResolutionMpx.toFixed(2)} MP/reference...`,
            );
            probeStitcher = getNativeApi().createStitcher();
            setPanoramaCompositingResolution(probeStitcher, probeResolutionMpx);
            probePanorama = new MatClass();
            const probeStatus = Number(probeStitcher.stitch(imageVector, probePanorama));
            if (probeStatus !== STITCHER_OK) {
              throw new Error(`Panorama stitching failed: ${statusMessage(probeStatus)}.`);
            }
            assertAllPanoramaInputsConnected(probeStitcher, images.length);
            const probeCrop = panoramaCropForStitchedImage(probeStitcher, probePanorama);
            if (!probeCrop) {
              throw new Error("Panorama probe has no covered rectangular output area.");
            }
            const referenceInput = session.images[0]!;
            const referenceInputPixels = referenceInput.width * referenceInput.height;
            const effectiveProbeResolutionMpx = Math.min(
              probeResolutionMpx,
              referenceInputPixels / 1_000_000,
            );
            userCompositingResolutionMpx = estimatePanoramaCompositingResolutionMpx({
              probeCompositingResolutionMpx: effectiveProbeResolutionMpx,
              probeOutputPixels: probeCrop.width * probeCrop.height,
              referenceInputPixels,
              maxOutputPixels,
            });
            probeComplete = true;
            break;
          } catch (error) {
            if (!isOpenCvAllocationFailure(error) || attempt + 1 >= PANORAMA_MAX_STITCH_ATTEMPTS) {
              if (isOpenCvAllocationFailure(error)) {
                throw new Error(
                  `Panorama size estimation exceeded the OpenCV WASM memory limit. ${describeOpenCvError(error)}`,
                );
              }
              throw error;
            }
            probeResolutionMpx = Math.max(
              PANORAMA_MIN_COMPOSITING_MPX,
              probeResolutionMpx * PANORAMA_RETRY_SCALE,
            );
          } finally {
            deleteNative(probePanorama);
            deleteNative(probeStitcher);
          }
        }
        if (!probeComplete) {
          throw new Error("Panorama size estimation did not produce an output image.");
        }
      }

      // User-selected Downscale is an approximate composition target used to reduce
      // memory use. The WASM memory budget is an additional safety constraint;
      // whichever requires the smaller composition is used. `none` leaves the
      // user target disabled. The final cropped panorama is not resized again.
      let compositingResolutionMpx = maxOutputPixels === null
        ? -1
        : tighterCompositingResolution(
            userCompositingResolutionMpx,
            memorySafeCompositingMpx,
          );
      let stitchStatus = Number.NaN;
      let lastAllocationError: unknown = null;

      for (let attempt = 0; attempt < PANORAMA_MAX_STITCH_ATTEMPTS; attempt += 1) {
        deleteNative(panorama);
        panorama = null;
        deleteNative(stitcher);
        stitcher = null;

        stitcher = getNativeApi().createStitcher();
        setPanoramaCompositingResolution(stitcher, compositingResolutionMpx);
        panorama = new MatClass();

        const resolutionText = compositingResolutionMpx < 0
          ? "full resolution"
          : `${compositingResolutionMpx.toFixed(2)} MP/reference`;
        const targetText = maxOutputMegapixels === null
          ? ""
          : `, target ~${maxOutputMegapixels}MP output`;
        postProgress(
          requestId,
          attempt === 0
            ? `Matching and composing panorama (${resolutionText}${targetText})...`
            : `Retrying panorama with lower memory use (${resolutionText}${targetText})...`,
        );

        try {
          // Use the same high-level API as the standalone Python
          // implementation. stitch() performs matching, camera estimation,
          // warping, seam finding and blending in one native call.
          stitchStatus = Number(stitcher.stitch(imageVector, panorama));
          lastAllocationError = null;
          break;
        } catch (error) {
          if (!isOpenCvAllocationFailure(error) || attempt + 1 >= PANORAMA_MAX_STITCH_ATTEMPTS) {
            if (isOpenCvAllocationFailure(error)) {
              const decoded = describeOpenCvError(error);
              throw new Error(
                `Panorama exceeded the OpenCV WASM memory limit even after reducing `
                + `the compositing resolution. ${decoded}`,
              );
            }
            throw error;
          }
          lastAllocationError = error;
          if (compositingResolutionMpx < 0) {
            const referenceInput = session.images[0]!;
            const referenceInputMpx = referenceInput.width * referenceInput.height / 1_000_000;
            compositingResolutionMpx = memorySafeCompositingMpx < 0
              ? Math.max(
                  PANORAMA_MIN_COMPOSITING_MPX,
                  referenceInputMpx * PANORAMA_RETRY_SCALE,
                )
              : memorySafeCompositingMpx;
          } else {
            compositingResolutionMpx = Math.max(
              PANORAMA_MIN_COMPOSITING_MPX,
              compositingResolutionMpx * PANORAMA_RETRY_SCALE,
            );
          }
        }
      }

      if (lastAllocationError) throw lastAllocationError;
      if (!stitcher || !panorama) {
        throw new Error("Panorama Stitcher did not produce an output image.");
      }
      if (stitchStatus !== STITCHER_OK) {
        throw new Error(`Panorama stitching failed: ${statusMessage(stitchStatus)}.`);
      }

      assertAllPanoramaInputsConnected(stitcher, images.length);
      const panoramaWidth = Number(panorama.cols);
      const panoramaHeight = Number(panorama.rows);
      if (
        !Number.isInteger(panoramaWidth)
        || !Number.isInteger(panoramaHeight)
        || panoramaWidth <= 0
        || panoramaHeight <= 0
      ) {
        throw new Error("Panorama Stitcher returned invalid output dimensions.");
      }
      const panoramaBgr = panorama.data.slice();

      postProgress(requestId, "Computing panorama coverage mask...");
      const crop = panoramaCropForStitchedImage(stitcher, panorama);
      postProgress(requestId, "Removing panorama margins...");
      if (!crop) throw new Error("Panorama has no covered rectangular output area.");

      return encodeCroppedPanorama(
        panoramaBgr,
        panoramaWidth,
        panoramaHeight,
        crop,
      );
    } finally {
      deleteNative(panorama);
      deleteNative(stitcher);
      deleteNative(imageVector);
      for (const image of images) deleteNative(image);
      session.close();
    }
  }
})();
