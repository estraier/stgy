// LibRaw-Wasm browser adapter shared by Local Image Studio and Local Stack Studio.
// The runtime files are built by STGY and served from public/vendor/.

export const LIBRAW_BROWSER_MODULE_URL = "/vendor/libraw-wasm/index.js";
export const LIBRAW_THREADED_BROWSER_MODULE_URL = "/vendor/libraw-wasm-threaded/index.js";
export const LIBRAW_THREADED_OPENMP_THREADS = 4;

export type LibRawRuntimeMode = "single" | "threaded";

export type LibRawSettingsLike = {
  outputColor?: number;
  outputBps?: 8 | 16;
  gamm?: [number, number, number, number, number, number];
  useCameraWb?: boolean;
  useCameraMatrix?: number;
  noAutoBright?: boolean;
  adjustMaximumThr?: number;
  threshold?: number;
  medPasses?: number;
  fbddNoiserd?: number;
  highlight?: number;
  userFlip?: number;
  userQual?: number;
};

export type LibRawLensMakerNotesLike = {
  Lens?: string;
  CurFocal?: number;
  CurAp?: number;
  FocalLengthIn35mmFormat?: number;
  [key: string]: unknown;
};

export type LibRawLensInfoLike = {
  Lens?: string;
  LensMake?: string;
  makernotes?: LibRawLensMakerNotesLike;
  [key: string]: unknown;
};

export type LibRawMetadataLike = {
  width?: number;
  height?: number;
  iso_speed?: number;
  shutter?: number;
  aperture?: number;
  focal_len?: number;
  camera_make?: string;
  camera_model?: string;
  normalized_make?: string;
  normalized_model?: string;
  lens?: LibRawLensInfoLike;
  [key: string]: unknown;
};

export type LibRawImageDataLike = {
  width: number;
  height: number;
  colors: number;
  bits: number;
  data: Uint8Array | Uint8ClampedArray | Uint16Array;
};

export type LibRawThumbnailDataLike = {
  width: number;
  height: number;
  format: "jpeg" | "bitmap" | "unknown";
  data: Uint8Array;
};

export type LibRawInstanceLike = {
  worker?: Worker;
  open(bytes: BufferSource, settings?: LibRawSettingsLike): Promise<void>;
  metadata(fullOutput?: boolean): Promise<LibRawMetadataLike | undefined>;
  imageData(): Promise<LibRawImageDataLike | undefined>;
  thumbnailData?(): Promise<LibRawThumbnailDataLike | undefined>;
  dispose?: () => void;
};

const RAW_IMAGE_EXTS = new Set([
  "3fr", "ari", "arw", "bay", "cap", "cr2", "cr3", "crw", "dcr", "dcs",
  "dng", "drf", "eip", "erf", "fff", "gpr", "iiq", "k25", "kdc", "mdc",
  "mef", "mos", "mrw", "nef", "nrw", "obm", "orf", "pef", "ptx", "pxn",
  "raf", "raw", "rwl", "rw2", "rwz", "sr2", "srf", "srw", "x3f",
]);

const RAW_IMAGE_MIMES = new Set([
  "image/x-adobe-dng", "image/x-canon-cr2", "image/x-canon-cr3", "image/x-epson-erf",
  "image/x-fuji-raf", "image/x-kodak-dcr", "image/x-kodak-k25", "image/x-minolta-mrw",
  "image/x-nikon-nef", "image/x-olympus-orf", "image/x-panasonic-rw2", "image/x-pentax-pef",
  "image/x-sony-arw", "image/x-sony-sr2", "image/x-sony-srf", "image/x-sigma-x3f", "image/dng",
]);

type LibRawBrowserModule = { default: new () => LibRawInstanceLike };

let singleModulePromise: Promise<LibRawBrowserModule> | null = null;
let threadedModulePromise: Promise<LibRawBrowserModule> | null = null;

export function isRawImageFile(name: string, type: string): boolean {
  const mime = String(type || "").toLowerCase();
  if (RAW_IMAGE_MIMES.has(mime)) return true;
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  return RAW_IMAGE_EXTS.has(extension);
}

function isLocalStudioPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/local-image-studio" || normalized === "/local-stack-studio";
}

export function resolveLibRawRuntimeMode(): LibRawRuntimeMode {
  if (typeof window === "undefined") return "single";
  if (!isLocalStudioPath(window.location.pathname)) return "single";
  if (!window.crossOriginIsolated) {
    throw new Error(
      "Local Image Studio and Local Stack Studio require cross-origin isolation for threaded LibRaw. Reload this page after confirming the COOP/COEP response headers.",
    );
  }
  return "threaded";
}

export function resolveLibRawOpenMpThreads(): number {
  return resolveLibRawRuntimeMode() === "threaded" ? LIBRAW_THREADED_OPENMP_THREADS : 1;
}

async function loadLibRawModule(mode: LibRawRuntimeMode): Promise<LibRawBrowserModule> {
  const moduleUrl = mode === "threaded" ? LIBRAW_THREADED_BROWSER_MODULE_URL : LIBRAW_BROWSER_MODULE_URL;
  const currentPromise = mode === "threaded" ? threadedModulePromise : singleModulePromise;
  if (currentPromise) return currentPromise;

  const promise = import(/* webpackIgnore: true */ moduleUrl) as Promise<LibRawBrowserModule>;
  if (mode === "threaded") threadedModulePromise = promise;
  else singleModulePromise = promise;

  return promise.catch((error) => {
    if (mode === "threaded") threadedModulePromise = null;
    else singleModulePromise = null;
    throw error;
  });
}

export async function createLibRawInstance(): Promise<LibRawInstanceLike> {
  if (typeof window === "undefined") throw new Error("LibRaw is only available in the browser");
  const mode = resolveLibRawRuntimeMode();
  const libRawModule = await loadLibRawModule(mode);
  if (typeof libRawModule?.default !== "function") {
    throw new Error(`LibRaw-Wasm ${mode} module does not provide its default constructor.`);
  }
  return new libRawModule.default();
}

export function createLibRawWorkerFailure(raw: LibRawInstanceLike): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  const worker = raw.worker;
  if (!worker || typeof worker.addEventListener !== "function") {
    return { promise: new Promise<never>(() => {}), cleanup: () => {} };
  }

  let onError: ((event: ErrorEvent) => void) | null = null;
  let onMessageError: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    onError = (event) => {
      const location = [event.filename, event.lineno, event.colno]
        .filter((value) => value !== undefined && value !== null && value !== "" && value !== 0)
        .join(":");
      const detail = event.message || "RAW decoder worker failed to load or initialize";
      reject(new Error(location ? `${detail} (${location})` : detail));
    };
    onMessageError = () => reject(new Error("RAW decoder worker communication failed"));
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
  });

  return {
    promise,
    cleanup: () => {
      if (onError) worker.removeEventListener("error", onError);
      if (onMessageError) worker.removeEventListener("messageerror", onMessageError);
    },
  };
}

export async function checkLibRawRuntime(): Promise<string> {
  const mode = resolveLibRawRuntimeMode();
  const raw = await createLibRawInstance();
  try {
    return `LibRaw-Wasm 1.6.0 / LibRaw 0.22.1 (${mode})`;
  } finally {
    raw.dispose?.();
  }
}
