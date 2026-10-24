// Local Stack Studio panorama worker. Built to public/generated/local-stack-studio.
import {
  openCanonicalReadSession,
  CANONICAL_LINEAR_RANGE_MAX,
  readCanonicalLinearRows,
  readCanonicalStoredRows,
} from "../stack/canonical-source";
import {
  fillPanoramaMarginsFromMask,
  largestValidPanoramaRectFromMask,
} from "../stack/panorama-crop";
import { choosePanoramaComposeScale } from "../stack/panorama-scale";
import {
  PANORAMA_ALIGNMENT_CLAHE_CLIP_LIMIT,
  PANORAMA_ALIGNMENT_CLAHE_TILE_GRID,
  PANORAMA_ALIGNMENT_PASSES,
  appendGamma2PanoramaAlignmentGray,
  applyPanoramaAlignmentExposureGain,
  boostPanoramaAlignmentDetailInPlace,
  panoramaAlignmentExposureGain,
  type PanoramaAlignmentPass,
} from "../stack/panorama-alignment";
import { restoreVerticalWaveCorrectionRoll } from "../stack/panorama-orientation";
import {
  DEFAULT_PANORAMA_FINISH_MODE,
  isSupportedPanoramaDownscaleMegapixels,
  isSupportedPanoramaFinishMode,
  type PanoramaFinishMode,
} from "../stack/panorama-options";
import {
  applyPanoramaGainBgrInPlace,
  estimatePanoramaGainMaps,
  samplePanoramaGainBgrInto,
  type PanoramaGainMap,
} from "../stack/panorama-exposure";
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
    setWaveCorrection: (flag: boolean) => void;
    setRegistrationResol?: (megapixels: number) => void;
    setPanoConfidenceThresh?: (threshold: number) => void;
  };
  type DynamicClahe = Deletable & {
    apply: (source: NativeMat, destination: NativeMat) => void;
    collectGarbage?: () => void;
  };
  type ConfiguredStitcher = {
    stitcher: DynamicStitcher;
    resources: Deletable[];
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
    buildMaps: (
      size: { width: number; height: number },
      camera: NativeMat,
      rotation: NativeMat,
      xmap: NativeMat,
      ymap: NativeMat,
    ) => unknown;
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
  type SeamAnalysis = {
    seams: SeamMask[];
    gainMaps: PanoramaGainMap[];
  };
  type PanoramaAlignmentResult = {
    stitcher: DynamicStitcher;
    stitcherResources: Deletable[];
    workScale: number;
    seamEstimationMegapixels: number;
    estimatedCameras: CameraState[];
    pass: PanoramaAlignmentPass;
  };

  const workerScope = globalThis as unknown as WorkerScope;
  const STITCHER_OK = 0;
  const INPUT_BYTE_MAX = 255;
  const STORED_UINT16_MAX = 65535;
  const PANORAMA_DEFAULT_SEAM_MPX = 0.1;
  const PANORAMA_ROWS_PER_READ = 128;
  const PANORAMA_SAMPLE_BAND_ROWS = 64;
  const CANONICAL_DECODE_LUT = buildCanonicalDecodeLut();
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
    createStitcher: (pass: PanoramaAlignmentPass) => ConfiguredStitcher;
    applyClahe: (source: NativeMat) => NativeMat;
    setRngSeed: ((seed: number) => void) | null;
    waveCorrectAuto: number;
    waveCorrect: (rotations: DynamicVector, kind: number) => unknown;
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
        message.finishMode ?? DEFAULT_PANORAMA_FINISH_MODE,
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
    // @banou/opencv-wasm is generated from OpenCV's wrapped API.
    // Stitcher::setWaveCorrectKind() itself is not CV_WRAP and therefore is not
    // exported by this build. Disable Stitcher's fixed HORIZ correction and use
    // the wrapped cv::detail::waveCorrect(..., WAVE_CORRECT_AUTO) explicitly
    // after bundle adjustment instead. Do not substitute enum values or aliases.
    const waveCorrectAuto = Number(openCvModule.detail_WAVE_CORRECT_AUTO);
    const waveCorrectFunction = openCvModule.detail_waveCorrect;
    if (!Number.isFinite(waveCorrectAuto)) {
      throw new Error("Panorama OpenCV build does not expose detail_WAVE_CORRECT_AUTO.");
    }
    if (typeof waveCorrectFunction !== "function") {
      throw new Error("Panorama OpenCV build does not expose detail_waveCorrect().");
    }
    const createStitcher = (pass: PanoramaAlignmentPass): ConfiguredStitcher => {
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
      try {
        if (
          typeof stitcher.estimateTransform !== "function"
          || typeof stitcher.component !== "function"
          || typeof stitcher.cameras !== "function"
          || typeof stitcher.workScale !== "function"
          || typeof stitcher.setWaveCorrection !== "function"
        ) {
          throw new Error("Panorama OpenCV Stitcher is missing required wrapped APIs.");
        }

        // OpenCV exposes these numeric tuning setters through CV_WRAP even
        // though the feature-finder/matcher injection setters are not wrapped
        // by @banou/opencv-wasm. Use only APIs that are actually available in
        // the browser build; stronger passes rely on progressively enhanced
        // proxy pixels plus higher registration resolution and lower panorama
        // confidence thresholds while keeping Stitcher's native ORB pipeline.
        stitcher.setRegistrationResol?.(pass.registrationMegapixels);
        stitcher.setPanoConfidenceThresh?.(pass.panoConfidence);

        // PANORAMA defaults to WAVE_CORRECT_HORIZ. Turn that off here so the
        // CameraParams returned by estimateTransform() are the bundle-adjusted,
        // un-wave-corrected rotations. AUTO correction is applied explicitly below.
        stitcher.setWaveCorrection(false);
        return { stitcher, resources: [] };
      } catch (error) {
        deleteNative(stitcher);
        throw error;
      }
    };

    const createClaheFactory = openCvModule.createCLAHE;
    const ClaheClass = openCvModule.CLAHE as (new (...args: unknown[]) => DynamicClahe) | undefined;
    const applyClahe = (source: NativeMat): NativeMat => {
      const destination = new (MatClass as NativeMatConstructor)();
      let clahe: DynamicClahe | null = null;
      try {
        if (typeof createClaheFactory === "function") {
          clahe = (createClaheFactory as (clipLimit: number, size: { width: number; height: number }) => DynamicClahe)(
            PANORAMA_ALIGNMENT_CLAHE_CLIP_LIMIT,
            { width: PANORAMA_ALIGNMENT_CLAHE_TILE_GRID, height: PANORAMA_ALIGNMENT_CLAHE_TILE_GRID },
          );
        } else if (typeof ClaheClass === "function") {
          clahe = new ClaheClass(
            PANORAMA_ALIGNMENT_CLAHE_CLIP_LIMIT,
            { width: PANORAMA_ALIGNMENT_CLAHE_TILE_GRID, height: PANORAMA_ALIGNMENT_CLAHE_TILE_GRID },
          );
        }
        if (!clahe || typeof clahe.apply !== "function") {
          throw new Error("Panorama OpenCV build does not expose CLAHE.");
        }
        clahe.apply(source, destination);
        return destination;
      } catch (error) {
        deleteNative(destination);
        throw error;
      } finally {
        try { clahe?.collectGarbage?.(); } catch {}
        deleteNative(clahe);
      }
    };

    const setRngSeedFunction = openCvModule.setRNGSeed;
    const setRngSeed = typeof setRngSeedFunction === "function"
      ? (seed: number): void => {
          (setRngSeedFunction as (value: number) => void)(seed | 0);
        }
      : null;


    const WarperClass = openCvModule.PyRotationWarper;
    if (typeof WarperClass !== "function") {
      throw new Error("Panorama OpenCV build does not expose PyRotationWarper.");
    }
    const createWarper = (scale: number): DynamicWarper => {
      const warper = new (WarperClass as new (type: string, scale: number) => DynamicWarper)("spherical", scale);
      if (typeof warper.warp !== "function" || typeof warper.warpRoi !== "function" || typeof warper.buildMaps !== "function") {
        deleteNative(warper);
        throw new Error("Panorama OpenCV PyRotationWarper is missing warp/warpRoi/buildMaps APIs.");
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
      applyClahe,
      setRngSeed,
      waveCorrectAuto,
      waveCorrect: waveCorrectFunction as (rotations: DynamicVector, kind: number) => unknown,
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

  function panoramaComponentIndices(stitcher: DynamicStitcher): number[] {
    let component: unknown = null;
    try {
      component = stitcher.component();
      const count = vectorLength(component);
      const indices: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const value = Number(vectorItem(component, index));
        if (Number.isInteger(value) && value >= 0) indices.push(value);
      }
      return indices;
    } finally {
      deleteNative(component);
    }
  }

  function validateMaxOutputMegapixels(value: number | null): number | null {
    if (value === null) return null;
    if (!isSupportedPanoramaDownscaleMegapixels(value)) {
      throw new Error(`Unsupported Panorama downscale: ${String(value)}MP.`);
    }
    return value;
  }

  function validateFinishMode(value: string): PanoramaFinishMode {
    if (!isSupportedPanoramaFinishMode(value)) {
      throw new Error(`Unsupported Panorama finish: ${String(value)}.`);
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

  async function loadCanonicalAlignmentGrayMat(
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    imageIndex: number,
  ): Promise<NativeMat> {
    const meta = session.images[imageIndex];
    if (!meta) throw new Error(`Canonical panorama input ${imageIndex + 1} is unavailable.`);
    const gray = new Uint8Array(meta.width * meta.height);
    const histogram = new Uint32Array(256);
    for (let startRow = 0; startRow < meta.height; startRow += PANORAMA_ROWS_PER_READ) {
      const rowCount = Math.min(PANORAMA_ROWS_PER_READ, meta.height - startRow);
      const storedRgb = await readCanonicalStoredRows(session, imageIndex, startRow, rowCount);
      appendGamma2PanoramaAlignmentGray(
        storedRgb,
        gray,
        startRow * meta.width,
        meta.linearRangeMax || CANONICAL_LINEAR_RANGE_MAX,
        histogram,
      );
    }
    applyPanoramaAlignmentExposureGain(gray, panoramaAlignmentExposureGain(histogram));
    const api = getNativeApi();
    return api.matFromArray(meta.height, meta.width, api.CV_8UC1, gray);
  }

  function buildClaheAlignmentImages(images: NativeMat[]): NativeMat[] {
    const api = getNativeApi();
    const output: NativeMat[] = [];
    try {
      for (const image of images) output.push(api.applyClahe(image));
      return output;
    } catch (error) {
      for (const image of output) deleteNative(image);
      throw error;
    }
  }

  function buildDetailBoostAlignmentImages(images: NativeMat[]): NativeMat[] {
    const api = getNativeApi();
    const output: NativeMat[] = [];
    try {
      for (const image of images) {
        const bytes = image.data.slice();
        boostPanoramaAlignmentDetailInPlace(bytes, image.cols, image.rows);
        output.push(api.matFromArray(image.rows, image.cols, api.CV_8UC1, bytes));
      }
      return output;
    } catch (error) {
      for (const image of output) deleteNative(image);
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

  function releaseConfiguredStitcher(configured: ConfiguredStitcher | null): void {
    if (!configured) return;
    deleteNative(configured.stitcher);
    for (const resource of configured.resources) deleteNative(resource);
  }

  function componentLabel(indices: number[]): string {
    if (indices.length === 0) return "none";
    return indices.map((index) => String(index + 1)).join(",");
  }

  function runPanoramaAlignmentAttempts(
    requestId: number,
    baseAlignmentImages: NativeMat[],
    getClaheAlignmentImages: () => NativeMat[],
    getDetailAlignmentImages: () => NativeMat[],
  ): PanoramaAlignmentResult {
    const api = getNativeApi();
    const expectedCount = baseAlignmentImages.length;
    const summaries: string[] = [];
    let bestConnected = 0;

    for (let passIndex = 0; passIndex < PANORAMA_ALIGNMENT_PASSES.length; passIndex += 1) {
      const pass = PANORAMA_ALIGNMENT_PASSES[passIndex]!;
      const images = pass.useDetailBoost
        ? getDetailAlignmentImages()
        : pass.useClahe
          ? getClaheAlignmentImages()
          : baseAlignmentImages;
      let vector: DynamicVector | unknown[] | null = null;
      let configured: ConfiguredStitcher | null = null;
      try {
        postProgress(
          requestId,
          `Panorama alignment ${passIndex + 1}/${PANORAMA_ALIGNMENT_PASSES.length}: ${pass.label} `
            + `(${pass.registrationMegapixels.toFixed(1)}MP, confidence ${pass.panoConfidence.toFixed(2)})...`,
        );
        api.setRngSeed?.(pass.rngSeed);
        vector = createNativeVector(images);
        configured = api.createStitcher(pass);
        const status = Number(configured.stitcher.estimateTransform(vector));
        if (status !== STITCHER_OK) {
          const summary = `${pass.label}: ${statusMessage(status)}`;
          summaries.push(summary);
          postProgress(requestId, `${summary}; retrying with a stronger panorama matcher...`);
          continue;
        }

        const component = panoramaComponentIndices(configured.stitcher);
        bestConnected = Math.max(bestConnected, component.length);
        const summary = `${pass.label}: connected ${component.length}/${expectedCount} [${componentLabel(component)}]`;
        summaries.push(summary);
        if (component.length !== expectedCount) {
          postProgress(requestId, `${summary}; retrying with a stronger panorama matcher...`);
          continue;
        }

        const workScale = Number(configured.stitcher.workScale());
        if (!Number.isFinite(workScale) || workScale <= 0) {
          throw new Error(`Panorama Stitcher returned invalid workScale ${String(workScale)}.`);
        }
        const estimatedCameras = readCameraStates(configured.stitcher);
        if (estimatedCameras.length !== expectedCount) {
          throw new Error(
            `Panorama Stitcher returned ${estimatedCameras.length} cameras for ${expectedCount} inputs.`,
          );
        }
        const seamEstimationMegapixels = typeof configured.stitcher.seamEstimationResol === "function"
          ? Number(configured.stitcher.seamEstimationResol())
          : PANORAMA_DEFAULT_SEAM_MPX;
        postProgress(requestId, `${summary}; camera geometry accepted.`);
        const result: PanoramaAlignmentResult = {
          stitcher: configured.stitcher,
          stitcherResources: configured.resources,
          workScale,
          seamEstimationMegapixels,
          estimatedCameras,
          pass,
        };
        configured = null;
        return result;
      } finally {
        if (!Array.isArray(vector)) deleteNative(vector);
        releaseConfiguredStitcher(configured);
      }
    }

    const detail = summaries.length > 0 ? ` (${summaries.join("; ")})` : "";
    throw new Error(
      `Panorama could connect only ${bestConnected} of ${expectedCount} input images after gamma-2, CLAHE, and detail-enhanced ORB retries.${detail}`,
    );
  }

  function diagnoseAdjacentPanoramaPairs(
    requestId: number,
    images: NativeMat[],
  ): string {
    if (images.length < 2) return "";
    const api = getNativeApi();
    const pass = PANORAMA_ALIGNMENT_PASSES[PANORAMA_ALIGNMENT_PASSES.length - 1]!;
    const results: string[] = [];
    for (let index = 0; index + 1 < images.length; index += 1) {
      let vector: DynamicVector | unknown[] | null = null;
      let configured: ConfiguredStitcher | null = null;
      try {
        api.setRngSeed?.((pass.rngSeed + index + 1) | 0);
        vector = createNativeVector([images[index]!, images[index + 1]!]);
        configured = api.createStitcher(pass);
        const status = Number(configured.stitcher.estimateTransform(vector));
        if (status !== STITCHER_OK) {
          results.push(`${index + 1}-${index + 2}: ${statusMessage(status)}`);
          continue;
        }
        const component = panoramaComponentIndices(configured.stitcher);
        results.push(`${index + 1}-${index + 2}: ${component.length === 2 ? "OK" : `connected ${component.length}/2`}`);
      } catch (error) {
        results.push(`${index + 1}-${index + 2}: ${describeOpenCvError(error)}`);
      } finally {
        if (!Array.isArray(vector)) deleteNative(vector);
        releaseConfiguredStitcher(configured);
      }
    }
    const summary = results.join(", ");
    if (summary) postProgress(requestId, `Panorama adjacent-pair diagnostics (${pass.label}): ${summary}`);
    return summary;
  }

  function applyAutoWaveCorrection(cameras: CameraState[]): CameraState[] {
    if (cameras.length <= 1) return cameras;
    const api = getNativeApi();
    const rotationMats: NativeMat[] = cameras.map((camera) =>
      api.matFromArray(3, 3, api.CV_32F, camera.rotation),
    );
    let rotationVector: DynamicVector | null = null;
    try {
      const vector = createNativeVector(rotationMats);
      if (Array.isArray(vector)) {
        throw new Error("Panorama OpenCV MatVector is required for automatic wave correction.");
      }
      rotationVector = vector;
      api.waveCorrect(rotationVector, api.waveCorrectAuto);
      const correctedCount = vectorLength(rotationVector);
      if (correctedCount !== cameras.length) {
        throw new Error(
          `Panorama automatic wave correction returned ${correctedCount} rotations for ${cameras.length} cameras.`,
        );
      }
      const corrected: CameraState[] = [];
      for (let index = 0; index < cameras.length; index += 1) {
        const correctedRotation = vectorItem(rotationVector, index);
        try {
          corrected.push({
            ...cameras[index]!,
            rotation: copyMatAsFloat32(correctedRotation, `wave-corrected camera ${index + 1} rotation`),
          });
        } finally {
          deleteNative(correctedRotation);
        }
      }

      // OpenCV's vertical wave correction changes the global camera basis by
      // roughly +/-90 degrees for a normal vertical pan. That makes upright
      // source images compose sideways. Preserve the corrected relative camera
      // geometry while restoring the original image-up orientation.
      const uprightRotations = restoreVerticalWaveCorrectionRoll(
        cameras.map((camera) => camera.rotation),
        corrected.map((camera) => camera.rotation),
      );
      return corrected.map((camera, index) => ({
        ...camera,
        rotation: uprightRotations[index]!,
      }));
    } finally {
      deleteNative(rotationVector);
      for (const rotation of rotationMats) deleteNative(rotation);
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

  function seamScaleForImages(seamEstimationMegapixels: number, width: number, height: number): number {
    const configured = Number.isFinite(seamEstimationMegapixels)
      ? seamEstimationMegapixels
      : PANORAMA_DEFAULT_SEAM_MPX;
    if (configured < 0) return 1;
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
    seamEstimationMegapixels: number,
    images: NativeMat[],
    cameras: CameraState[],
    workScale: number,
  ): SeamAnalysis {
    const api = getNativeApi();
    const seamScale = seamScaleForImages(seamEstimationMegapixels, images[0]!.cols, images[0]!.rows);
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
      postProgress(requestId, "Computing local panorama exposure/WB compensation...");
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

      // Estimate OpenCV BlocksChannelsCompensator-style local RGB gains from
      // the low-resolution spherical overlaps. Keep this outside native
      // ExposureCompensator.apply(), because that path is 8-bit; the same gain
      // maps are later applied to canonical float32 pixels.
      const exposureProxies = warpedFloatImages.map((image, index) => {
        const bgr = image.data32F;
        const mask = warpedMasks[index]!.data;
        if (!(bgr instanceof Float32Array) || bgr.length < image.rows * image.cols * 3) {
          throw new Error(`Panorama exposure proxy ${index + 1} has an unreadable float buffer.`);
        }
        if (!(mask instanceof Uint8Array) || mask.length < image.rows * image.cols) {
          throw new Error(`Panorama exposure mask ${index + 1} has an unreadable buffer.`);
        }
        return {
          cornerX: Math.round(corners[index]!.x),
          cornerY: Math.round(corners[index]!.y),
          width: image.cols,
          height: image.rows,
          bgr,
          mask,
        };
      });
      const gainMaps = estimatePanoramaGainMaps(exposureProxies);
      for (let index = 0; index < warpedFloatImages.length; index += 1) {
        const image = warpedFloatImages[index]!;
        const bgr = image.data32F;
        if (!(bgr instanceof Float32Array)) {
          throw new Error(`Panorama exposure proxy ${index + 1} lost its float buffer.`);
        }
        applyPanoramaGainBgrInPlace(bgr, image.cols, image.rows, gainMaps[index]!);
      }

      postProgress(requestId, "Computing OpenCV GraphCut panorama seam...");
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
      const seams = masks.map((data, index) => ({
        corner: corners[index]!,
        width: sizes[index]!.width,
        height: sizes[index]!.height,
        data,
      }));
      return { seams, gainMaps };
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

  function buildCanonicalDecodeLut(): Float32Array {
    const lut = new Float32Array(STORED_UINT16_MAX + 1);
    for (let sample = 0; sample <= STORED_UINT16_MAX; sample += 1) {
      const encoded = sample / STORED_UINT16_MAX;
      lut[sample] = encoded * encoded * CANONICAL_LINEAR_RANGE_MAX;
    }
    return lut;
  }

  function mapData32F(mat: NativeMat, label: string): Float32Array {
    const data = mat.data32F;
    if (!(data instanceof Float32Array) || data.length < mat.rows * mat.cols) {
      throw new Error(`Panorama ${label} map has an unreadable float32 buffer.`);
    }
    return data;
  }

  function resizedCoordinateToCanonical(
    coordinate: number,
    resizedLength: number,
    canonicalLength: number,
  ): number {
    if (resizedLength <= 0 || canonicalLength <= 0) return 0;
    const scale = resizedLength / canonicalLength;
    return (coordinate + 0.5) / scale - 0.5;
  }

  function sampleStoredLinearBilinear(
    storedRows: Uint16Array,
    storedStartRow: number,
    sourceWidth: number,
    sourceHeight: number,
    sourceX: number,
    sourceY: number,
    channel: number,
  ): number {
    const x = Math.min(sourceWidth - 1, Math.max(0, sourceX));
    const y = Math.min(sourceHeight - 1, Math.max(0, sourceY));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sourceWidth - 1, x0 + 1);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const localY0 = y0 - storedStartRow;
    const localY1 = y1 - storedStartRow;
    if (localY0 < 0 || localY1 < 0) return 0;
    const rowPixels = sourceWidth * 3;
    const i00 = localY0 * rowPixels + x0 * 3 + channel;
    const i10 = localY0 * rowPixels + x1 * 3 + channel;
    const i01 = localY1 * rowPixels + x0 * 3 + channel;
    const i11 = localY1 * rowPixels + x1 * 3 + channel;
    if (i11 >= storedRows.length) return 0;
    const v00 = CANONICAL_DECODE_LUT[storedRows[i00] ?? 0] ?? 0;
    const v10 = CANONICAL_DECODE_LUT[storedRows[i10] ?? 0] ?? 0;
    const v01 = CANONICAL_DECODE_LUT[storedRows[i01] ?? 0] ?? 0;
    const v11 = CANONICAL_DECODE_LUT[storedRows[i11] ?? 0] ?? 0;
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }

  async function composeHighPrecisionPanorama(
    requestId: number,
    session: Awaited<ReturnType<typeof openCanonicalReadSession>>,
    cameras: CameraState[],
    seams: SeamMask[],
    gainMaps: PanoramaGainMap[],
    workScale: number,
    composeScale: number,
    maxOutputMegapixels: number | null,
    finishMode: PanoramaFinishMode,
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
        postProgress(requestId, `Mapping full-precision panorama image ${index + 1}/${cameras.length}...`);
        const meta = session.images[index];
        if (!meta) throw new Error(`Canonical panorama input ${index + 1} is unavailable.`);
        const targetWidth = Math.max(1, Math.round(meta.width * composeScale));
        const targetHeight = Math.max(1, Math.round(meta.height * composeScale));
        let cameraMatrix: NativeMat | null = null;
        let rotation: NativeMat | null = null;
        let xmap: NativeMat | null = null;
        let ymap: NativeMat | null = null;
        try {
          cameraMatrix = createCameraMatrix(cameras[index]!, composeWorkAspect);
          rotation = createRotationMatrix(cameras[index]!);
          xmap = new api.Mat();
          ymap = new api.Mat();
          const buildMapsRect = rectFromUnknown(
            warper.buildMaps(
              { width: targetWidth, height: targetHeight },
              cameraMatrix,
              rotation,
              xmap,
              ymap,
            ),
            `compose ${index + 1}`,
          );
          const projectedRect = rectangles[index]!;
          // OpenCV's RotationWarper::buildMaps() creates maps with
          // (dst_br - dst_tl + 1) pixels, but returns Rect(dst_tl, dst_br),
          // whose C++ Rect width/height are one pixel smaller. warpRoi(), on
          // the other hand, returns the actual warped image/map dimensions.
          // Therefore use buildMaps() only for the top-left and use warpRoi()
          // plus the actual map Mat dimensions for the extent.
          if (xmap.rows !== ymap.rows || xmap.cols !== ymap.cols) {
            throw new Error(`Panorama compose map ${index + 1} X/Y dimensions do not match.`);
          }
          if (
            buildMapsRect.x !== projectedRect.x
            || buildMapsRect.y !== projectedRect.y
            || xmap.rows !== projectedRect.height
            || xmap.cols !== projectedRect.width
          ) {
            throw new Error(
              `Panorama compose map ${index + 1} does not match warpRoi `
              + `(map ${xmap.cols}×${xmap.rows} at ${buildMapsRect.x},${buildMapsRect.y}; `
              + `ROI ${projectedRect.width}×${projectedRect.height} at ${projectedRect.x},${projectedRect.y}).`,
            );
          }
          const mapRect: Rect = projectedRect;
          const xmapData = mapData32F(xmap, `compose ${index + 1} X`);
          const ymapData = mapData32F(ymap, `compose ${index + 1} Y`);
          const seam = seams[index]!;
          const gainMap = gainMaps[index]!;
          const gainSample = new Float32Array(3);
          const offsetX = Math.round(mapRect.x - union.x);
          const offsetY = Math.round(mapRect.y - union.y);

          for (let bandStart = 0; bandStart < mapRect.height; bandStart += PANORAMA_SAMPLE_BAND_ROWS) {
            const bandEnd = Math.min(mapRect.height, bandStart + PANORAMA_SAMPLE_BAND_ROWS);
            let minSourceRow = meta.height;
            let maxSourceRow = -1;
            for (let y = bandStart; y < bandEnd; y += 1) {
              let localPixel = y * mapRect.width;
              for (let x = 0; x < mapRect.width; x += 1, localPixel += 1) {
                const mapX = xmapData[localPixel]!;
                const mapY = ymapData[localPixel]!;
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY) || mapX < 0 || mapY < 0 || mapX > targetWidth - 1 || mapY > targetHeight - 1) continue;
                const canonicalY = resizedCoordinateToCanonical(mapY, targetHeight, meta.height);
                if (!Number.isFinite(canonicalY)) continue;
                const clampedY = Math.min(meta.height - 1, Math.max(0, canonicalY));
                minSourceRow = Math.min(minSourceRow, Math.floor(clampedY));
                maxSourceRow = Math.max(maxSourceRow, Math.min(meta.height - 1, Math.floor(clampedY) + 1));
              }
            }
            if (maxSourceRow < minSourceRow) continue;
            const storedRows = await readCanonicalStoredRows(
              session,
              index,
              minSourceRow,
              maxSourceRow - minSourceRow + 1,
            );

            for (let y = bandStart; y < bandEnd; y += 1) {
              const canvasY = offsetY + y;
              if (canvasY < 0 || canvasY >= union.height) continue;
              let localPixel = y * mapRect.width;
              let canvasPixel = canvasY * union.width + offsetX;
              for (let x = 0; x < mapRect.width; x += 1, localPixel += 1, canvasPixel += 1) {
                const canvasX = offsetX + x;
                if (canvasX < 0 || canvasX >= union.width) continue;
                const mapX = xmapData[localPixel]!;
                const mapY = ymapData[localPixel]!;
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY) || mapX < 0 || mapY < 0 || mapX > targetWidth - 1 || mapY > targetHeight - 1) continue;
                coverage[canvasPixel] = 1;
                const seamClass = seamClassAt(seam, x, y, mapRect.width, mapRect.height);
                const edgeDistance = Math.min(x, y, mapRect.width - 1 - x, mapRect.height - 1 - y);
                const edgeNormalization = Math.max(1, Math.min(mapRect.width, mapRect.height) * 0.5);
                const interior = Math.min(0.999, Math.max(0, edgeDistance / edgeNormalization));
                const score = (seamClass === 2
                  ? SEAM_CORE_SCORE
                  : seamClass === 1
                    ? SEAM_NEAR_SCORE
                    : SEAM_FALLBACK_SCORE) + interior;
                if (score <= winnerScore[canvasPixel]!) continue;
                winnerScore[canvasPixel] = score;

                const canonicalX = resizedCoordinateToCanonical(mapX, targetWidth, meta.width);
                const canonicalY = resizedCoordinateToCanonical(mapY, targetHeight, meta.height);
                samplePanoramaGainBgrInto(gainMap, x, y, mapRect.width, mapRect.height, gainSample);
                const destination = canvasPixel * 3;
                const r = sampleStoredLinearBilinear(storedRows, minSourceRow, meta.width, meta.height, canonicalX, canonicalY, 0);
                const g = sampleStoredLinearBilinear(storedRows, minSourceRow, meta.width, meta.height, canonicalX, canonicalY, 1);
                const b = sampleStoredLinearBilinear(storedRows, minSourceRow, meta.width, meta.height, canonicalX, canonicalY, 2);
                gamma2Canvas[destination] = encodeResultGamma2(r * gainSample[2]!);
                gamma2Canvas[destination + 1] = encodeResultGamma2(g * gainSample[1]!);
                gamma2Canvas[destination + 2] = encodeResultGamma2(b * gainSample[0]!);
              }
            }
          }
        } finally {
          deleteNative(ymap);
          deleteNative(xmap);
          deleteNative(rotation);
          deleteNative(cameraMatrix);
        }
      }
    } finally {
      deleteNative(warper);
    }

    if (finishMode === "fill") {
      postProgress(requestId, "Filling panorama margins from adjacent image colors...");
      fillPanoramaMarginsFromMask(
        gamma2Canvas,
        coverage,
        union.width,
        union.height,
        new Uint32Array(winnerScore.buffer),
      );
      return {
        width: union.width,
        height: union.height,
        gamma2Rgb: gamma2Canvas,
      };
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
    requestedFinishMode: string = DEFAULT_PANORAMA_FINISH_MODE,
  ): Promise<{ width: number; height: number; gamma2Rgb: Uint16Array }> {
    if (!sessionId) throw new Error("Panorama canonical session id is required.");
    const maxOutputMegapixels = validateMaxOutputMegapixels(requestedMaxOutputMegapixels);
    const finishMode = validateFinishMode(requestedFinishMode);
    const maxOutputPixels = maxOutputMegapixels === null ? null : maxOutputMegapixels * 1_000_000;

    postProgress(requestId, "Loading panorama OpenCV...");
    await ensureOpenCv();
    const session = await openCanonicalReadSession(sessionId, cacheBytes);
    const alignmentImages: NativeMat[] = [];
    const seamProxyImages: NativeMat[] = [];
    let claheAlignmentImages: NativeMat[] = [];
    let detailAlignmentImages: NativeMat[] = [];
    let stitcher: DynamicStitcher | null = null;
    let stitcherResources: Deletable[] = [];

    try {
      if (session.images.length < 2) throw new Error("Panorama requires at least two input images.");

      for (let index = 0; index < session.images.length; index += 1) {
        postProgress(
          requestId,
          `Preparing gamma-2 grayscale panorama alignment proxy ${index + 1}/${session.images.length}...`,
        );
        alignmentImages.push(await loadCanonicalAlignmentGrayMat(session, index));
      }

      const getClaheAlignmentImages = (): NativeMat[] => {
        if (claheAlignmentImages.length === 0) {
          postProgress(requestId, "Preparing CLAHE panorama alignment fallback...");
          claheAlignmentImages = buildClaheAlignmentImages(alignmentImages);
        }
        return claheAlignmentImages;
      };

      const getDetailAlignmentImages = (): NativeMat[] => {
        if (detailAlignmentImages.length === 0) {
          postProgress(requestId, "Preparing detail-enhanced panorama alignment fallback...");
          detailAlignmentImages = buildDetailBoostAlignmentImages(getClaheAlignmentImages());
        }
        return detailAlignmentImages;
      };

      let alignment: PanoramaAlignmentResult;
      try {
        alignment = runPanoramaAlignmentAttempts(
          requestId,
          alignmentImages,
          getClaheAlignmentImages,
          getDetailAlignmentImages,
        );
      } catch (error) {
        const diagnostics = diagnoseAdjacentPanoramaPairs(
          requestId,
          getDetailAlignmentImages(),
        );
        const message = error instanceof Error ? error.message : describeOpenCvError(error);
        throw new Error(diagnostics ? `${message} Adjacent pairs: ${diagnostics}.` : message);
      }

      stitcher = alignment.stitcher;
      stitcherResources = alignment.stitcherResources;
      const workScale = alignment.workScale;
      const seamEstimationMegapixels = alignment.seamEstimationMegapixels;
      const estimatedCameras = alignment.estimatedCameras;

      // Camera geometry is fully captured above. Release the Stitcher and
      // grayscale alignment proxies before allocating the existing three-channel
      // seam proxies so robust fallback matching does not raise peak memory.
      deleteNative(stitcher);
      stitcher = null;
      for (const resource of stitcherResources) deleteNative(resource);
      stitcherResources = [];
      for (const proxy of alignmentImages) deleteNative(proxy);
      alignmentImages.length = 0;
      for (const proxy of claheAlignmentImages) deleteNative(proxy);
      claheAlignmentImages.length = 0;
      for (const proxy of detailAlignmentImages) deleteNative(proxy);
      detailAlignmentImages.length = 0;

      // Alignment uses a dedicated gamma-2 grayscale proxy. Keep the existing
      // linear BGR proxy exclusively for seam/exposure analysis so stronger
      // feature preprocessing cannot alter GraphCut, local gains, or final pixels.
      for (let index = 0; index < session.images.length; index += 1) {
        postProgress(requestId, `Preparing panorama seam proxy ${index + 1}/${session.images.length}...`);
        seamProxyImages.push(await loadCanonicalBgr8Mat(session, index));
      }

      postProgress(requestId, "Applying OpenCV automatic horizontal/vertical wave correction...");
      const cameras = applyAutoWaveCorrection(estimatedCameras);

      const seamAnalysis = buildGraphCutSeams(
        requestId,
        seamEstimationMegapixels,
        seamProxyImages,
        cameras,
        workScale,
      );
      const seams = seamAnalysis.seams;
      const gainMaps = seamAnalysis.gainMaps;
      const cropRatio = finishMode === "trim" ? estimateCoverageCropRatio(seams) : 1;
      const imageSizes = session.images.map((image) => ({ width: image.width, height: image.height }));
      const fullUnion = unionRects(projectedRects(cameras, imageSizes, workScale, 1));
      const composeScale = choosePanoramaComposeScale({
        fullUnionPixels: fullUnion.width * fullUnion.height,
        cropRatio,
        maxOutputPixels,
      });

      // The high-level Stitcher was deliberately discarded after camera
      // estimation. Its native composePanorama path converts the result to
      // CV_8U. Geometry, bundle adjustment, spherical camera parameters and
      // GraphCut seam decisions have already been captured above. Final pixels
      // are sampled directly from canonical gamma-2 Uint16 storage; only the
      // four neighboring samples are decoded to linear float for bilinear
      // interpolation and gain correction.
      for (const proxy of seamProxyImages) deleteNative(proxy);
      seamProxyImages.length = 0;

      return await composeHighPrecisionPanorama(
        requestId,
        session,
        cameras,
        seams,
        gainMaps,
        workScale,
        composeScale,
        maxOutputMegapixels,
        finishMode,
      );
    } finally {
      deleteNative(stitcher);
      for (const resource of stitcherResources) deleteNative(resource);
      for (const proxy of seamProxyImages) deleteNative(proxy);
      for (const proxy of alignmentImages) deleteNative(proxy);
      for (const proxy of claheAlignmentImages) deleteNative(proxy);
      for (const proxy of detailAlignmentImages) deleteNative(proxy);
      session.close();
    }
  }

})();
