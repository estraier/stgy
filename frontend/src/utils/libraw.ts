export const LIBRAW_WASM_VERSION = "1.6.0";
export const LIBRAW_VERSION = "0.22.1";
export const LIBRAW_BROWSER_MODULE_URL = "/vendor/libraw-wasm/index.js";

type LibRawConstructor<T> = new () => T;

export async function createLibRawBrowserInstance<T>(): Promise<T> {
  // Keep the LibRaw worker/WASM runtime out of Next/Webpack's chunk graph.
  // predev/prebuild publishes the fixed STGY build under public/vendor.
  const mod = (await import(/* webpackIgnore: true */ LIBRAW_BROWSER_MODULE_URL)) as {
    default: LibRawConstructor<T>;
  };
  if (typeof mod.default !== "function") {
    throw new Error("LibRaw module did not expose its constructor");
  }
  return new mod.default();
}

export async function checkLibRawRuntime(): Promise<string> {
  let instance: { dispose?: () => void } | null = null;
  try {
    instance = await createLibRawBrowserInstance<{ dispose?: () => void }>();
    return `LibRaw-Wasm ${LIBRAW_WASM_VERSION} / LibRaw ${LIBRAW_VERSION}`;
  } finally {
    instance?.dispose?.();
  }
}
