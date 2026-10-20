// Local Stack Studio panorama worker. Built to public/generated/local-stack-studio.
import {
  openCanonicalReadSession,
  readCanonicalLinearRows,
} from "../stack/canonical-source";
import { largestValidPanoramaRectFromMask } from "../stack/panorama-crop";
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
  type NativeUMat = Deletable & {
    rows?: number;
    cols?: number;
    getMat?: (accessFlags: number) => NativeMat;
  };
  type NativeUMatConstructor = new (...args: unknown[]) => NativeUMat;
  type NativeMat = Deletable & {
    rows: number;
    cols: number;
    data: Uint8Array;
    data32F?: Float32Array;
    data64F?: Float64Array;
    getUMat?: (accessFlags: number) => NativeUMat;
  };
  type NativeMatConstructor = new (...args: unknown[]) => NativeMat;
  type DynamicVector = Deletable & {
    size?: () => number;
    get?: (index: number) => unknown;
    push_back?: (value: unknown) => void;
  };
  type DynamicStitcher = Deletable & {
    estimateTransform: (images: unknown) => number;
    component: () => unknown;
    cameras: () => unknown;
    workScale: () => number;
    seamEstimationResol?: () => number;
  };
  type DynamicWarper = Deletable & {
    warp: (
      source: NativeMat,
      camera: NativeMat,
      rotation: NativeMat,
      interpolation: number,
      borderMode: number,
      destination: NativeMat,
    ) => unknown;
    warpRoi: (size: { width: number; height: number }, camera: NativeMat, rotation: NativeMat) => unknown;
  };
  type DynamicSeamFinder = Deletable & {
    find: (images: unknown, corners: unknown, masks: unknown) => unknown;
  };
  type CameraState = {
    focal: number;
    aspect: number;
    ppx: number;
    ppy: number;
    rotation: Float32Array;
  };
  type Point = { x: number; y: number };
  type Rect = { x: number; y: number; width: number; height: number };
  type SeamMask = {
    corner: Point;
    width: number;
    height: number;
    data: Uint8Array;
  };

  const workerScope = globalThis as unknown as WorkerScope;
  const STITCHER_OK = 0;
  const INPUT_BYTE_MAX = 255;
  const STORED_UINT16_MAX = 65535;
  const PANORAMA_DEFAULT_SEAM_MPX = 0.1;
  const PANORAMA_ROWS_PER_READ = 128;
  const PANORAMA_MODULE_URL = "/vendor/opencv-stitching/lib/index.js";
  const PANORAMA_WASM_URL = "/vendor/opencv-stitching/lib/opencv_js.wasm";
  const GRAPH_CUT_TERMINAL_COST = 10_000;
  const GRAPH_CUT_BAD_REGION_PENALTY = 1_000;
  const SEAM_CORE_SCORE = 3_000_000;
  const SEAM_NEAR_SCORE = 2_000_000;
  const SEAM_FALLBACK_SCORE = 1_000_000;

  let openCvModulePromise: Promise<Record<string, unknown>> | null = null;
  let loadedOpenCvModule: Record<string, unknown> | null = null;
  let openCvRuntime: Record<string, unknown> | null = null;
  let initPromise: Promise<void> | null = null;
  let nativeApi: {
    Mat: NativeMatConstructor;
    UMat: NativeUMatConstructor;
    MatVector: new () => DynamicVector;
    UMatVector: new () => DynamicVector;
    PointVector: (new () => DynamicVector) | null;
    ACCESS_READ: number;
    ACCESS_RW: number;
    CV_8UC1: number;
    CV_8UC3: number;
    CV_32FC3: number;
    CV_32F: number;
    INTER_LINEAR: number;
    INTER_LINEAR_EXACT: number;
    INTER_NEAREST: number;
    BORDER_REFLECT: number;
    BORDER_CONSTANT: number;
    matFromArray: (rows: number, cols: number, type: number, data: ArrayLike<number>) => NativeMat;
    resize: (
      source: NativeMat,
      destination: NativeMat,
      size: { width: number; height: number },
      fx: number,
      fy: number,
      interpolation: number,
    ) => void;
    createStitcher: () => DynamicStitcher;
    createWarper: (scale: number) => DynamicWarper;
    createGraphCutSeamFinder: () => DynamicSeamFinder;
  } | null = null;

  workerScope.onmessage = async (event: MessageEvent<PanoramaWorkerRequest>) => {
    const message = event.data;
    const requestId = message.requestId;
    try {
      if (message.type !== "stitch") {
        throw new Error(`Unsupported panorama worker request: ${String((message as { type?: unknown }).type)}`);
      }
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

  function numericConstant(module: Record<string, unknown>, name: string, fallbackName?: string): number {
    const primary = Number(module[name]);
    if (Number.isFinite(primary)) return primary;
    if (fallbackName) {
      const fallback = Number(module[fallbackName]);
      if (Number.isFinite(fallback)) return fallback;
    }
    throw new Error(`Panorama OpenCV build is missing ${name}.`);
  }

  function resolveNativeApi(openCvModule: Record<string, unknown>): NonNullable<typeof nativeApi> {
    const MatClass = openCvModule.Mat;
    const UMatClass = openCvModule.UMat;
    const MatVectorClass = openCvModule.MatVector;
    const UMatVectorClass = openCvModule.UMatVector;
    const PointVectorClass = openCvModule.PointVector;
    const matFromArrayFunction = openCvModule.matFromArray;
    const resizeFunction = openCvModule.resize;
    if (
      typeof MatClass !== "function"
      || typeof UMatClass !== "function"
      || typeof MatVectorClass !== "function"
      || typeof UMatVectorClass !== "function"
      || typeof matFromArrayFunction !== "function"
      || typeof resizeFunction !== "function"
    ) {
      throw new Error("Panorama OpenCV build is missing required matrix/vector APIs.");
    }

    const StitcherClass = openCvModule.Stitcher as { create?: (mode?: number) => unknown } | undefined;
    const flatStitcherFactory = openCvModule.Stitcher_create;
    const panoramaMode = Number(openCvModule.Stitcher_PANORAMA ?? 0);
    const createStitcher = (): DynamicStitcher => {
      let created: unknown = null;
      if (StitcherClass && typeof StitcherClass.create === "function") {
        created = StitcherClass.create(panoramaMode);
      } else if (typeof flatStitcherFactory === "function") {
        created = (flatStitcherFactory as (mode?: number) => unknown)(panoramaMode);
      }
      if (!created || typeof created !== "object") {
        throw new Error("Panorama OpenCV build does not expose the Stitcher factory.");
      }
      const stitcher = created as DynamicStitcher;
      if (
        typeof stitcher.estimateTransform !== "function"
        || typeof stitcher.component !== "function"
        || typeof stitcher.cameras !== "function"
        || typeof stitcher.workScale !== "function"
      ) {
        deleteNative(stitcher);
        throw new Error("Panorama OpenCV Stitcher is missing estimateTransform/cameras/workScale APIs.");
      }
      return stitcher;
    };

    const WarperClass = openCvModule.PyRotationWarper;
    if (typeof WarperClass !== "function") {
      throw new Error("Panorama OpenCV build does not expose PyRotationWarper.");
    }
    const createWarper = (scale: number): DynamicWarper => {
      const warper = new (WarperClass as new (type: string, scale: number) => DynamicWarper)("spherical", scale);
      if (typeof warper.warp !== "function" || typeof warper.warpRoi !== "function") {
        deleteNative(warper);
        throw new Error("Panorama OpenCV PyRotationWarper is missing warp/warpRoi APIs.");
      }
      return warper;
    };

    const SeamFinderClass = openCvModule.detail_GraphCutSeamFinder ?? openCvModule.GraphCutSeamFinder;
    if (typeof SeamFinderClass !== "function") {
      throw new Error("Panorama OpenCV build does not expose GraphCutSeamFinder.");
    }
    const createGraphCutSeamFinder = (): DynamicSeamFinder => {
      const finder = new (SeamFinderClass as new (
        costType: string,
        terminalCost: number,
        badRegionPenalty: number,
      ) => DynamicSeamFinder)(
        "COST_COLOR",
        GRAPH_CUT_TERMINAL_COST,
        GRAPH_CUT_BAD_REGION_PENALTY,
      );
      if (typeof finder.find !== "function") {
        deleteNative(finder);
        throw new Error("Panorama OpenCV GraphCutSeamFinder is missing find().");
      }
      return finder;
    };

    const interLinear = numericConstant(openCvModule, "INTER_LINEAR");
    const interLinearExact = Number(openCvModule.INTER_LINEAR_EXACT);

    return {
      Mat: MatClass as NativeMatConstructor,
      UMat: UMatClass as NativeUMatConstructor,
      MatVector: MatVectorClass as new () => DynamicVector,
      UMatVector: UMatVectorClass as new () => DynamicVector,
      PointVector: typeof PointVectorClass === "function" ? PointVectorClass as new () => DynamicVector : null,
      ACCESS_READ: numericConstant(openCvModule, "ACCESS_READ"),
      ACCESS_RW: numericConstant(openCvModule, "ACCESS_RW"),
      CV_8UC1: numericConstant(openCvModule, "CV_8UC1"),
      CV_8UC3: numericConstant(openCvModule, "CV_8UC3"),
      CV_32FC3: numericConstant(openCvModule, "CV_32FC3"),
      CV_32F: numericConstant(openCvModule, "CV_32F", "CV_32FC1"),
      INTER_LINEAR: interLinear,
      INTER_LINEAR_EXACT: Number.isFinite(interLinearExact) ? interLinearExact : interLinear,
      INTER_NEAREST: numericConstant(openCvModule, "INTER_NEAREST"),
      BORDER_REFLECT: numericConstant(openCvModule, "BORDER_REFLECT"),
      BORDER_CONSTANT: numericConstant(openCvModule, "BORDER_CONSTANT"),
      matFromArray: matFromArrayFunction as NonNullable<typeof nativeApi>["matFromArray"],
      resize: resizeFunction as NonNullable<typeof nativeApi>["resize"],
      createStitcher,
      createWarper,
      createGraphCutSeamFinder,
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
        } catch {}
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
        } catch {}
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
    throw new Error("Panorama OpenCV returned an unreadable native vector.");
  }

  function vectorItem(value: unknown, index: number): unknown {
    if (Array.isArray(value)) return value[index];
    if (ArrayBuffer.isView(value)) return (value as unknown as ArrayLike<unknown>)[index];
    if (value && typeof value === "object" && typeof (value as DynamicVector).get === "function") {
      return (value as DynamicVector).get!(index);
    }
    throw new Error("Panorama OpenCV native vector does not expose get().");
  }

  function createNativeVector(values: unknown[], PointVector = false): DynamicVector | unknown[] {
    const api = getNativeApi();
    const VectorClass = PointVector ? api.PointVector : api.MatVector;
    if (!VectorClass) return values;
    const vector = new VectorClass();
    if (typeof vector.push_back !== "function") {
      deleteNative(vector);
      throw new Error("Panorama OpenCV native vector does not expose push_back().");
    }
    for (const value of values) vector.push_back(value);
    return vector;
  }

  function copyMatToUMat(mat: NativeMat, type: number): NativeUMat {
    const api = getNativeApi();
    const umat = new api.UMat(mat.rows, mat.cols, type);
    if (!umat || typeof umat !== "object" || typeof umat.getMat !== "function") {
      deleteNative(umat);
      throw new Error("Panorama OpenCV UMat does not expose getMat().");
    }
    let mapped: NativeMat | null = null;
    try {
      mapped = umat.getMat(api.ACCESS_RW);
      if (!mapped || typeof mapped !== "object") {
        throw new Error("Panorama OpenCV could not map UMat host memory.");
      }
      if (type === api.CV_32FC3) {
        if (!(mat.data32F instanceof Float32Array) || !(mapped.data32F instanceof Float32Array)) {
          throw new Error("Panorama OpenCV could not copy float32 pixels into UMat.");
        }
        mapped.data32F.set(mat.data32F);
      } else {
        if (!(mat.data instanceof Uint8Array) || !(mapped.data instanceof Uint8Array)) {
          throw new Error("Panorama OpenCV could not copy byte pixels into UMat.");
        }
        mapped.data.set(mat.data);
      }
      return umat;
    } catch (error) {
      deleteNative(umat);
      throw error;
    } finally {
      deleteNative(mapped);
    }
  }

  function createUMatVectorFromMats(
    mats: NativeMat[],
    type: number,
  ): { vector: DynamicVector; umats: NativeUMat[] } {
    const api = getNativeApi();
    const vector = new api.UMatVector();
    const umats: NativeUMat[] = [];
    if (typeof vector.push_back !== "function") {
      deleteNative(vector);
      throw new Error("Panorama OpenCV UMatVector does not expose push_back().");
    }
    try {
      for (const mat of mats) {
        const umat = copyMatToUMat(mat, type);
        umats.push(umat);
        vector.push_back(umat);
      }
      return { vector, umats };
    } catch (error) {
      for (const umat of umats) deleteNative(umat);
      deleteNative(vector);
      throw error;
    }
  }

  function assertAllPanoramaInputsConnected(stitcher: DynamicStitcher, expectedCount: number): void {
    let component: unknown = null;
    try {
      component = stitcher.component();
      const componentCount = vectorLength(component);
      if (componentCount !== expectedCount) {
        throw new Error(`Panorama could connect only ${componentCount} of ${expectedCount} input images.`);
      }
    } finally {
      deleteNative(component);
    }
  }

  function validateMaxOutputMegapixels(value: number | null): number | null {
    if (value === null) return null;
    if (![4, 8, 16, 32, 64].includes(value)) {
      throw new Error(`Unsupported Panorama downscale: ${String(value)}MP.`);
    }
    return value;
  }

  async function loadCanonicalBgr8Mat(
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    imageIndex: number,
  ): Promise<NativeMat> {
    const meta = session.images[imageIndex];
    if (!meta) throw new Error(`Canonical panorama input ${imageIndex + 1} is unavailable.`);
    const bgr = new Uint8Array(meta.width * meta.height * 3);
    for (let startRow = 0; startRow < meta.height; startRow += PANORAMA_ROWS_PER_READ) {
      const rowCount = Math.min(PANORAMA_ROWS_PER_READ, meta.height - startRow);
      const linearRgb = await readCanonicalLinearRows(session, imageIndex, startRow, rowCount);
      let destination = startRow * meta.width * 3;
      for (let source = 0; source < linearRgb.length; source += 3, destination += 3) {
        const r = Math.min(1, Math.max(0, linearRgb[source] ?? 0));
        const g = Math.min(1, Math.max(0, linearRgb[source + 1] ?? 0));
        const b = Math.min(1, Math.max(0, linearRgb[source + 2] ?? 0));
        bgr[destination] = Math.floor(b * INPUT_BYTE_MAX);
        bgr[destination + 1] = Math.floor(g * INPUT_BYTE_MAX);
        bgr[destination + 2] = Math.floor(r * INPUT_BYTE_MAX);
      }
    }
    const api = getNativeApi();
    return api.matFromArray(meta.height, meta.width, api.CV_8UC3, bgr);
  }

  async function loadCanonicalLinearRgbMat(
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    imageIndex: number,
  ): Promise<NativeMat> {
    const meta = session.images[imageIndex];
    if (!meta) throw new Error(`Canonical panorama input ${imageIndex + 1} is unavailable.`);
    const api = getNativeApi();
    const mat = new api.Mat(meta.height, meta.width, api.CV_32FC3);
    const destination = mat.data32F;
    if (!(destination instanceof Float32Array) || destination.length < meta.width * meta.height * 3) {
      deleteNative(mat);
      throw new Error("Panorama OpenCV could not allocate the float32 source image.");
    }
    try {
      for (let startRow = 0; startRow < meta.height; startRow += PANORAMA_ROWS_PER_READ) {
        const rowCount = Math.min(PANORAMA_ROWS_PER_READ, meta.height - startRow);
        const linearRgb = await readCanonicalLinearRows(session, imageIndex, startRow, rowCount);
        destination.set(linearRgb, startRow * meta.width * 3);
      }
      return mat;
    } catch (error) {
      deleteNative(mat);
      throw error;
    }
  }

  function copyMatAsFloat32(mat: unknown, label: string): Float32Array {
    if (!mat || typeof mat !== "object") throw new Error(`Panorama ${label} matrix is unavailable.`);
    const item = mat as NativeMat;
    if (item.data32F instanceof Float32Array && item.data32F.length >= 9) {
      return new Float32Array(item.data32F.slice(0, 9));
    }
    if (item.data64F instanceof Float64Array && item.data64F.length >= 9) {
      return new Float32Array(Array.from(item.data64F.slice(0, 9)));
    }
    throw new Error(`Panorama ${label} matrix does not expose 3x3 floating-point data.`);
  }

  function readCameraStates(stitcher: DynamicStitcher): CameraState[] {
    let cameraVector: unknown = null;
    const cameras: CameraState[] = [];
    try {
      cameraVector = stitcher.cameras();
      const count = vectorLength(cameraVector);
      for (let index = 0; index < count; index += 1) {
        const rawCamera = vectorItem(cameraVector, index);
        if (!rawCamera || typeof rawCamera !== "object") {
          throw new Error(`Panorama camera ${index + 1} is unavailable.`);
        }
        const camera = rawCamera as Record<string, unknown> & Deletable;
        const focal = Number(camera.focal);
        const aspect = Number(camera.aspect);
        const ppx = Number(camera.ppx);
        const ppy = Number(camera.ppy);
        if (![focal, aspect, ppx, ppy].every(Number.isFinite) || focal <= 0 || aspect <= 0) {
          deleteNative(rawCamera);
          throw new Error(`Panorama camera ${index + 1} has invalid intrinsic parameters.`);
        }
        const rotationHandle = camera.R;
        try {
          cameras.push({
            focal,
            aspect,
            ppx,
            ppy,
            rotation: copyMatAsFloat32(rotationHandle, `camera ${index + 1} rotation`),
          });
        } finally {
          deleteNative(rotationHandle);
          deleteNative(rawCamera);
        }
      }
      return cameras;
    } finally {
      deleteNative(cameraVector);
    }
  }

  function medianFocal(cameras: CameraState[]): number {
    if (cameras.length === 0) throw new Error("Panorama has no estimated cameras.");
    const focals = cameras.map((camera) => camera.focal).sort((left, right) => left - right);
    const middle = Math.floor(focals.length / 2);
    if (focals.length % 2 === 1) return focals[middle]!;
    return (focals[middle - 1]! + focals[middle]!) * 0.5;
  }

  function createCameraMatrix(camera: CameraState, scaleFromWork: number): NativeMat {
    const api = getNativeApi();
    const focal = camera.focal * scaleFromWork;
    const ppx = camera.ppx * scaleFromWork;
    const ppy = camera.ppy * scaleFromWork;
    return api.matFromArray(3, 3, api.CV_32F, new Float32Array([
      focal, 0, ppx,
      0, focal * camera.aspect, ppy,
      0, 0, 1,
    ]));
  }

  function createRotationMatrix(camera: CameraState): NativeMat {
    const api = getNativeApi();
    return api.matFromArray(3, 3, api.CV_32F, camera.rotation);
  }

  function pointFromUnknown(value: unknown, label: string): Point {
    if (!value || typeof value !== "object") throw new Error(`Panorama ${label} point is unavailable.`);
    const item = value as { x?: unknown; y?: unknown };
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Panorama ${label} point is invalid.`);
    return { x, y };
  }

  function rectFromUnknown(value: unknown, label: string): Rect {
    if (!value || typeof value !== "object") throw new Error(`Panorama ${label} rectangle is unavailable.`);
    const item = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    const x = Number(item.x);
    const y = Number(item.y);
    const width = Number(item.width);
    const height = Number(item.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error(`Panorama ${label} rectangle is invalid.`);
    }
    return { x, y, width, height };
  }

  function unionRects(rectangles: Rect[]): Rect {
    if (rectangles.length === 0) throw new Error("Panorama has no projected image rectangles.");
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rectangle of rectangles) {
      left = Math.min(left, rectangle.x);
      top = Math.min(top, rectangle.y);
      right = Math.max(right, rectangle.x + rectangle.width);
      bottom = Math.max(bottom, rectangle.y + rectangle.height);
    }
    return {
      x: Math.floor(left),
      y: Math.floor(top),
      width: Math.max(1, Math.ceil(right) - Math.floor(left)),
      height: Math.max(1, Math.ceil(bottom) - Math.floor(top)),
    };
  }

  function resizeMat(source: NativeMat, width: number, height: number, interpolation: number): NativeMat {
    if (source.cols === width && source.rows === height) return source;
    const api = getNativeApi();
    const destination = new api.Mat();
    try {
      api.resize(source, destination, { width, height }, 0, 0, interpolation);
      return destination;
    } catch (error) {
      deleteNative(destination);
      throw error;
    }
  }

  function fullMask(width: number, height: number): NativeMat {
    const api = getNativeApi();
    const mask = new api.Mat(height, width, api.CV_8UC1);
    if (!(mask.data instanceof Uint8Array) || mask.data.length < width * height) {
      deleteNative(mask);
      throw new Error("Panorama OpenCV could not allocate a coverage mask.");
    }
    mask.data.fill(INPUT_BYTE_MAX);
    return mask;
  }

  function warpedFloatForGraphCut(image: NativeMat): NativeMat {
    const api = getNativeApi();
    if (!(image.data instanceof Uint8Array) || image.data.length < image.rows * image.cols * 3) {
      throw new Error("Panorama seam image has an unreadable 8-bit buffer.");
    }
    const floats = new Float32Array(image.rows * image.cols * 3);
    for (let index = 0; index < floats.length; index += 1) floats[index] = image.data[index]!;
    return api.matFromArray(image.rows, image.cols, api.CV_32FC3, floats);
  }

  function seamScaleForImages(stitcher: DynamicStitcher, width: number, height: number): number {
    const configured = typeof stitcher.seamEstimationResol === "function"
      ? Number(stitcher.seamEstimationResol())
      : PANORAMA_DEFAULT_SEAM_MPX;
    if (!Number.isFinite(configured) || configured < 0) return 1;
    return Math.min(1, Math.sqrt(configured * 1_000_000 / Math.max(1, width * height)));
  }

  function readMasksFromUMatVector(maskVector: DynamicVector, expectedCount: number): Uint8Array[] {
    const api = getNativeApi();
    const masks: Uint8Array[] = [];
    for (let index = 0; index < expectedCount; index += 1) {
      const value = vectorItem(maskVector, index);
      if (!value || typeof value !== "object") throw new Error(`Panorama seam mask ${index + 1} is unavailable.`);
      const umat = value as NativeUMat;
      let mat: NativeMat | null = null;
      try {
        if (typeof umat.getMat !== "function") {
          throw new Error(`Panorama seam mask ${index + 1} is not a readable UMat.`);
        }
        mat = umat.getMat(api.ACCESS_READ);
        if (!(mat.data instanceof Uint8Array) || mat.data.length < mat.rows * mat.cols) {
          throw new Error(`Panorama seam mask ${index + 1} has an unreadable buffer.`);
        }
        masks.push(mat.data.slice(0, mat.rows * mat.cols));
      } finally {
        deleteNative(mat);
        deleteNative(value);
      }
    }
    return masks;
  }

  function estimateCoverageCropRatio(seams: SeamMask[]): number {
    if (seams.length === 0) return 1;
    const rectangles = seams.map((seam) => ({
      x: seam.corner.x,
      y: seam.corner.y,
      width: seam.width,
      height: seam.height,
    }));
    const union = unionRects(rectangles);
    const pixelCount = union.width * union.height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > 32_000_000) return 1;
    const coverage = new Uint8Array(pixelCount);
    for (const seam of seams) {
      const offsetX = Math.round(seam.corner.x - union.x);
      const offsetY = Math.round(seam.corner.y - union.y);
      for (let y = 0; y < seam.height; y += 1) {
        const globalY = offsetY + y;
        if (globalY < 0 || globalY >= union.height) continue;
        let local = y * seam.width;
        let global = globalY * union.width + offsetX;
        for (let x = 0; x < seam.width; x += 1, local += 1, global += 1) {
          if (offsetX + x < 0 || offsetX + x >= union.width) continue;
          if (seam.data[local] !== 0) coverage[global] = 1;
        }
      }
    }
    const crop = largestValidPanoramaRectFromMask(coverage, union.width, union.height);
    if (!crop) return 1;
    return Math.min(1, Math.max(0.05, (crop.width * crop.height) / pixelCount));
  }

  function buildGraphCutSeams(
    requestId: number,
    stitcher: DynamicStitcher,
    images: NativeMat[],
    cameras: CameraState[],
    workScale: number,
  ): SeamMask[] {
    const api = getNativeApi();
    const seamScale = seamScaleForImages(stitcher, images[0]!.cols, images[0]!.rows);
    const seamWorkAspect = seamScale / workScale;
    const warperScale = medianFocal(cameras) * seamWorkAspect;
    const warper = api.createWarper(warperScale);
    const warpedFloatImages: NativeMat[] = [];
    const warpedMasks: NativeMat[] = [];
    const corners: Point[] = [];
    const sizes: Array<{ width: number; height: number }> = [];
    let imageVector: DynamicVector | null = null;
    let maskVector: DynamicVector | null = null;
    let imageUMats: NativeUMat[] = [];
    let maskUMats: NativeUMat[] = [];
    let cornerVector: DynamicVector | unknown[] | null = null;
    let seamFinder: DynamicSeamFinder | null = null;

    try {
      postProgress(requestId, "Computing OpenCV GraphCut panorama seam...");
      for (let index = 0; index < images.length; index += 1) {
        const source = images[index]!;
        const camera = cameras[index]!;
        const seamWidth = Math.max(1, Math.round(source.cols * seamScale));
        const seamHeight = Math.max(1, Math.round(source.rows * seamScale));
        const seamImage = resizeMat(source, seamWidth, seamHeight, api.INTER_LINEAR_EXACT);
        const seamImageOwned = seamImage !== source;
        let cameraMatrix: NativeMat | null = null;
        let rotation: NativeMat | null = null;
        let warpedImage: NativeMat | null = null;
        let sourceMask: NativeMat | null = null;
        let warpedMask: NativeMat | null = null;
        try {
          cameraMatrix = createCameraMatrix(camera, seamWorkAspect);
          rotation = createRotationMatrix(camera);
          warpedImage = new api.Mat();
          const corner = pointFromUnknown(
            warper.warp(
              seamImage,
              cameraMatrix,
              rotation,
              api.INTER_LINEAR,
              api.BORDER_REFLECT,
              warpedImage,
            ),
            `seam ${index + 1}`,
          );
          sourceMask = fullMask(seamWidth, seamHeight);
          warpedMask = new api.Mat();
          warper.warp(
            sourceMask,
            cameraMatrix,
            rotation,
            api.INTER_NEAREST,
            api.BORDER_CONSTANT,
            warpedMask,
          );
          warpedFloatImages.push(warpedFloatForGraphCut(warpedImage));
          warpedMasks.push(warpedMask);
          warpedMask = null;
          corners.push(corner);
          sizes.push({ width: warpedImage.cols, height: warpedImage.rows });
        } finally {
          deleteNative(warpedMask);
          deleteNative(sourceMask);
          deleteNative(warpedImage);
          deleteNative(rotation);
          deleteNative(cameraMatrix);
          if (seamImageOwned) deleteNative(seamImage);
        }
      }

      // GraphCutSeamFinder operates on vector<UMat>; unlike estimateTransform(),
      // this path must remain UMatVector in this generated binding.
      const imageInputs = createUMatVectorFromMats(warpedFloatImages, api.CV_32FC3);
      imageVector = imageInputs.vector;
      imageUMats = imageInputs.umats;
      const maskInputs = createUMatVectorFromMats(warpedMasks, api.CV_8UC1);
      maskVector = maskInputs.vector;
      maskUMats = maskInputs.umats;
      cornerVector = createNativeVector(corners, true);
      seamFinder = api.createGraphCutSeamFinder();
      seamFinder.find(imageVector, cornerVector, maskVector);
      const masks = readMasksFromUMatVector(maskVector, warpedMasks.length);
      return masks.map((data, index) => ({
        corner: corners[index]!,
        width: sizes[index]!.width,
        height: sizes[index]!.height,
        data,
      }));
    } finally {
      deleteNative(seamFinder);
      if (!Array.isArray(cornerVector)) deleteNative(cornerVector);
      deleteNative(maskVector);
      deleteNative(imageVector);
      for (const umat of maskUMats) deleteNative(umat);
      for (const umat of imageUMats) deleteNative(umat);
      for (const mask of warpedMasks) deleteNative(mask);
      for (const image of warpedFloatImages) deleteNative(image);
      deleteNative(warper);
    }
  }

  function projectedRects(
    cameras: CameraState[],
    imageSizes: Array<{ width: number; height: number }>,
    workScale: number,
    composeScale: number,
  ): Rect[] {
    const api = getNativeApi();
    const composeWorkAspect = composeScale / workScale;
    const warper = api.createWarper(medianFocal(cameras) * composeWorkAspect);
    const rectangles: Rect[] = [];
    try {
      for (let index = 0; index < cameras.length; index += 1) {
        const cameraMatrix = createCameraMatrix(cameras[index]!, composeWorkAspect);
        const rotation = createRotationMatrix(cameras[index]!);
        try {
          const width = Math.max(1, Math.round(imageSizes[index]!.width * composeScale));
          const height = Math.max(1, Math.round(imageSizes[index]!.height * composeScale));
          rectangles.push(rectFromUnknown(
            warper.warpRoi({ width, height }, cameraMatrix, rotation),
            `compose ROI ${index + 1}`,
          ));
        } finally {
          deleteNative(rotation);
          deleteNative(cameraMatrix);
        }
      }
      return rectangles;
    } finally {
      deleteNative(warper);
    }
  }

  function chooseComposeScale(
    cameras: CameraState[],
    imageSizes: Array<{ width: number; height: number }>,
    workScale: number,
    cropRatio: number,
    maxOutputPixels: number | null,
  ): number {
    if (maxOutputPixels === null) return 1;
    const fullUnion = unionRects(projectedRects(cameras, imageSizes, workScale, 1));
    const estimatedCropPixels = fullUnion.width * fullUnion.height * cropRatio;
    if (!Number.isFinite(estimatedCropPixels) || estimatedCropPixels <= maxOutputPixels) return 1;
    return Math.min(1, Math.max(0.01, Math.sqrt(maxOutputPixels / estimatedCropPixels)));
  }

  function seamClassAt(seam: SeamMask, x: number, y: number, width: number, height: number): number {
    const sx = Math.min(seam.width - 1, Math.max(0, Math.floor((x + 0.5) * seam.width / Math.max(1, width))));
    const sy = Math.min(seam.height - 1, Math.max(0, Math.floor((y + 0.5) * seam.height / Math.max(1, height))));
    if (seam.data[sy * seam.width + sx] !== 0) return 2;
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = sy + dy;
      if (yy < 0 || yy >= seam.height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = sx + dx;
        if (xx < 0 || xx >= seam.width) continue;
        if (seam.data[yy * seam.width + xx] !== 0) return 1;
      }
    }
    return 0;
  }

  function encodeResultGamma2(linear: number): number {
    const normalized = Math.min(1, Math.max(0, linear));
    return Math.round(Math.sqrt(normalized) * STORED_UINT16_MAX);
  }

  function cropGamma2Output(
    source: Uint16Array,
    canvasWidth: number,
    crop: { x: number; y: number; width: number; height: number },
  ): Uint16Array {
    if (crop.x === 0 && crop.y === 0 && crop.width === canvasWidth && source.length === crop.width * crop.height * 3) {
      return source;
    }
    const output = new Uint16Array(crop.width * crop.height * 3);
    for (let y = 0; y < crop.height; y += 1) {
      const sourceStart = ((crop.y + y) * canvasWidth + crop.x) * 3;
      const sourceEnd = sourceStart + crop.width * 3;
      output.set(source.subarray(sourceStart, sourceEnd), y * crop.width * 3);
    }
    return output;
  }

  async function composeHighPrecisionPanorama(
    requestId: number,
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    cameras: CameraState[],
    seams: SeamMask[],
    workScale: number,
    composeScale: number,
    maxOutputMegapixels: number | null,
  ): Promise<{ width: number; height: number; gamma2Rgb: Uint16Array }> {
    const api = getNativeApi();
    const imageSizes = session.images.map((image) => ({ width: image.width, height: image.height }));
    const composeWorkAspect = composeScale / workScale;
    const warper = api.createWarper(medianFocal(cameras) * composeWorkAspect);
    const rectangles = projectedRects(cameras, imageSizes, workScale, composeScale);
    const union = unionRects(rectangles);
    const pixelCount = union.width * union.height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) {
      deleteNative(warper);
      throw new Error("Panorama projected output size is invalid.");
    }

    postProgress(
      requestId,
      maxOutputMegapixels === null
        ? `Composing high-precision OpenCV panorama (${union.width}×${union.height})...`
        : `Composing high-precision OpenCV panorama (~${maxOutputMegapixels}MP target, ${union.width}×${union.height})...`,
    );

    const gamma2Canvas = new Uint16Array(pixelCount * 3);
    const winnerScore = new Float32Array(pixelCount);
    const coverage = new Uint8Array(pixelCount);

    try {
      for (let index = 0; index < cameras.length; index += 1) {
        postProgress(requestId, `Warping full-precision panorama image ${index + 1}/${cameras.length}...`);
        const sourceFull = await loadCanonicalLinearRgbMat(session, index);
        const targetWidth = Math.max(1, Math.round(sourceFull.cols * composeScale));
        const targetHeight = Math.max(1, Math.round(sourceFull.rows * composeScale));
        const resized = resizeMat(sourceFull, targetWidth, targetHeight, api.INTER_LINEAR_EXACT);
        const resizedOwned = resized !== sourceFull;
        let cameraMatrix: NativeMat | null = null;
        let rotation: NativeMat | null = null;
        let warped: NativeMat | null = null;
        let sourceMask: NativeMat | null = null;
        let warpedMask: NativeMat | null = null;
        try {
          cameraMatrix = createCameraMatrix(cameras[index]!, composeWorkAspect);
          rotation = createRotationMatrix(cameras[index]!);
          warped = new api.Mat();
          const corner = pointFromUnknown(
            warper.warp(
              resized,
              cameraMatrix,
              rotation,
              api.INTER_LINEAR,
              api.BORDER_REFLECT,
              warped,
            ),
            `compose ${index + 1}`,
          );
          sourceMask = fullMask(targetWidth, targetHeight);
          warpedMask = new api.Mat();
          warper.warp(
            sourceMask,
            cameraMatrix,
            rotation,
            api.INTER_NEAREST,
            api.BORDER_CONSTANT,
            warpedMask,
          );

          const rgb = warped.data32F;
          const mask = warpedMask.data;
          if (!(rgb instanceof Float32Array) || rgb.length < warped.rows * warped.cols * 3) {
            throw new Error(`Panorama warped image ${index + 1} has an unreadable float32 buffer.`);
          }
          if (!(mask instanceof Uint8Array) || mask.length < warped.rows * warped.cols) {
            throw new Error(`Panorama warped mask ${index + 1} has an unreadable buffer.`);
          }

          const seam = seams[index]!;
          const offsetX = Math.round(corner.x - union.x);
          const offsetY = Math.round(corner.y - union.y);
          for (let y = 0; y < warped.rows; y += 1) {
            const canvasY = offsetY + y;
            if (canvasY < 0 || canvasY >= union.height) continue;
            let localPixel = y * warped.cols;
            let canvasPixel = canvasY * union.width + offsetX;
            for (let x = 0; x < warped.cols; x += 1, localPixel += 1, canvasPixel += 1) {
              const canvasX = offsetX + x;
              if (canvasX < 0 || canvasX >= union.width || mask[localPixel] === 0) continue;
              coverage[canvasPixel] = 1;
              const seamClass = seamClassAt(seam, x, y, warped.cols, warped.rows);
              const edgeDistance = Math.min(x, y, warped.cols - 1 - x, warped.rows - 1 - y);
              const edgeNormalization = Math.max(1, Math.min(warped.cols, warped.rows) * 0.5);
              const interior = Math.min(0.999, Math.max(0, edgeDistance / edgeNormalization));
              const score = (seamClass === 2
                ? SEAM_CORE_SCORE
                : seamClass === 1
                  ? SEAM_NEAR_SCORE
                  : SEAM_FALLBACK_SCORE) + interior;
              if (score <= winnerScore[canvasPixel]!) continue;
              winnerScore[canvasPixel] = score;
              const source = localPixel * 3;
              const destination = canvasPixel * 3;
              gamma2Canvas[destination] = encodeResultGamma2(rgb[source] ?? 0);
              gamma2Canvas[destination + 1] = encodeResultGamma2(rgb[source + 1] ?? 0);
              gamma2Canvas[destination + 2] = encodeResultGamma2(rgb[source + 2] ?? 0);
            }
          }
        } finally {
          deleteNative(warpedMask);
          deleteNative(sourceMask);
          deleteNative(warped);
          deleteNative(rotation);
          deleteNative(cameraMatrix);
          if (resizedOwned) deleteNative(resized);
          deleteNative(sourceFull);
        }
      }
    } finally {
      deleteNative(warper);
    }

    postProgress(requestId, "Removing panorama margins...");
    const crop = largestValidPanoramaRectFromMask(coverage, union.width, union.height);
    if (!crop) throw new Error("Panorama has no covered rectangular output area.");
    return {
      width: crop.width,
      height: crop.height,
      gamma2Rgb: cropGamma2Output(gamma2Canvas, union.width, crop),
    };
  }

  async function stitchCanonicalPanorama(
    requestId: number,
    sessionId: string,
    cacheBytes?: number,
    requestedMaxOutputMegapixels: number | null = null,
  ): Promise<{ width: number; height: number; gamma2Rgb: Uint16Array }> {
    if (!sessionId) throw new Error("Panorama canonical session id is required.");
    const maxOutputMegapixels = validateMaxOutputMegapixels(requestedMaxOutputMegapixels);
    const maxOutputPixels = maxOutputMegapixels === null ? null : maxOutputMegapixels * 1_000_000;

    postProgress(requestId, "Loading panorama OpenCV...");
    await ensureOpenCv();
    const session = await openCanonicalReadSession(sessionId, cacheBytes);
    const proxyImages: NativeMat[] = [];
    let proxyVector: DynamicVector | null = null;
    let stitcher: DynamicStitcher | null = null;

    try {
      if (session.images.length < 2) throw new Error("Panorama requires at least two input images.");

      for (let index = 0; index < session.images.length; index += 1) {
        postProgress(requestId, `Preparing 8-bit alignment proxy ${index + 1}/${session.images.length}...`);
        proxyImages.push(await loadCanonicalBgr8Mat(session, index));
      }
      const api = getNativeApi();
      // @banou/opencv-wasm exposes the unsuffixed Stitcher.estimateTransform()
      // overload with MatVector. GraphCutSeamFinder.find(), however, follows
      // OpenCV's vector<UMat> signature below, so do not unify these vector types.
      proxyVector = createNativeVector(proxyImages) as DynamicVector;
      stitcher = api.createStitcher();

      postProgress(requestId, "Estimating OpenCV panorama cameras and bundle adjustment...");
      const status = Number(stitcher.estimateTransform(proxyVector));
      if (status !== STITCHER_OK) {
        throw new Error(`Panorama alignment failed: ${statusMessage(status)}.`);
      }
      assertAllPanoramaInputsConnected(stitcher, proxyImages.length);

      const workScale = Number(stitcher.workScale());
      if (!Number.isFinite(workScale) || workScale <= 0) {
        throw new Error(`Panorama Stitcher returned invalid workScale ${String(workScale)}.`);
      }
      const cameras = readCameraStates(stitcher);
      if (cameras.length !== proxyImages.length) {
        throw new Error(`Panorama Stitcher returned ${cameras.length} cameras for ${proxyImages.length} inputs.`);
      }

      const seams = buildGraphCutSeams(requestId, stitcher, proxyImages, cameras, workScale);
      const cropRatio = estimateCoverageCropRatio(seams);
      const imageSizes = session.images.map((image) => ({ width: image.width, height: image.height }));
      const composeScale = chooseComposeScale(
        cameras,
        imageSizes,
        workScale,
        cropRatio,
        maxOutputPixels,
      );

      // The high-level Stitcher is deliberately discarded here. Its native
      // composePanorama path converts the result to CV_8U. Geometry, bundle
      // adjustment, spherical camera parameters and GraphCut seam decisions
      // have already been captured above; final pixels are composed separately
      // from canonical float32 sources to preserve 16-bit output precision.
      deleteNative(stitcher);
      stitcher = null;
      deleteNative(proxyVector);
      proxyVector = null;
      for (const proxy of proxyImages) deleteNative(proxy);
      proxyImages.length = 0;

      return await composeHighPrecisionPanorama(
        requestId,
        session,
        cameras,
        seams,
        workScale,
        composeScale,
        maxOutputMegapixels,
      );
    } finally {
      deleteNative(stitcher);
      if (!Array.isArray(proxyVector)) deleteNative(proxyVector);
      for (const proxy of proxyImages) deleteNative(proxy);
      session.close();
    }
  }
})();
