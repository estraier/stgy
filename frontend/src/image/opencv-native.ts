/**
 * Single browser OpenCV backend for STGY: @banou/opencv-wasm 0.0.6.
 *
 * The package's ESM exports are its cv namespace. They are not the OpenCV.js
 * global object, and ES module namespaces are immutable; expose our small
 * compatibility constructors on a separate object. Every worker/main-thread
 * execution context owns one native heap; do not pass native handles between
 * contexts. The JS/WASM files are built/copied from the same npm dependency.
 */
export const OPENCV_MODULE_URL = "/vendor/opencv/lib/index.js";
export const OPENCV_WASM_URL = "/vendor/opencv/lib/opencv_js.wasm";

export type NativeOpenCvModule = Record<string, unknown> & {
  Mat: new (...args: number[]) => { delete(): void };
};

let openCvNativePromise: Promise<NativeOpenCvModule> | null = null;

export function loadOpenCvNative(): Promise<NativeOpenCvModule> {
  if (openCvNativePromise) return openCvNativePromise;
  openCvNativePromise = (async () => {
    // URL-based runtime import, not a Next/esbuild dependency. The asset must
    // be served intact because its ESM files use relative imports.
    const native = await import(/* webpackIgnore: true */ OPENCV_MODULE_URL) as Record<string, unknown>;
    const initialize = native.initOpenCV;
    if (typeof initialize !== "function") {
      throw new Error("The packaged OpenCV ESM module is missing initOpenCV().");
    }
    await (initialize as (options: { wasmUrl: string }) => Promise<unknown>)({ wasmUrl: OPENCV_WASM_URL });
    if (typeof native.Mat !== "function") {
      throw new Error("The packaged OpenCV build is missing Mat.");
    }
    // Both constructors are plain native argument records in this binding.
    // Callers use `new cv.Size(...)` / `new cv.Rect(...)` (OpenCV.js syntax).
    const Size = class {
      constructor(public width: number, public height: number) {}
    };
    const Rect = class {
      constructor(public x: number, public y: number, public width: number, public height: number) {}
    };
    return Object.assign(Object.create(null) as object, native, { Size, Rect }) as unknown as NativeOpenCvModule;
  })().catch((error) => {
    // Permit an explicit retry after load failure, e.g. a transient asset error.
    openCvNativePromise = null;
    throw error;
  });
  return openCvNativePromise;
}
