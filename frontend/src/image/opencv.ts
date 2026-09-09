export const OPENCV_PACKAGE_VERSION = "5.0.0-release.1";
export const OPENCV_VERSION = "5.0.0";
export const OPENCV_BROWSER_SCRIPT_URL = "/vendor/opencv/opencv.js";

export type OpenCvRuntime = {
  Mat: new (...args: unknown[]) => { delete(): void };
  getBuildInformation?: () => string;
  onRuntimeInitialized?: () => void;
};

type OpenCvGlobal = OpenCvRuntime | PromiseLike<OpenCvRuntime>;

declare global {
  interface Window {
    cv?: OpenCvGlobal;
  }
}

let openCvPromise: Promise<OpenCvRuntime> | null = null;

function isPromiseLike(value: unknown): value is PromiseLike<OpenCvRuntime> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as PromiseLike<OpenCvRuntime>).then === "function",
  );
}

async function initializedOpenCvFromGlobal(): Promise<OpenCvRuntime> {
  const globalCv = window.cv;
  if (!globalCv) throw new Error("OpenCV global API unavailable");

  if (isPromiseLike(globalCv)) {
    const cv = await globalCv;
    if (typeof cv?.Mat !== "function") throw new Error("OpenCV runtime did not initialize");
    return cv;
  }

  if (typeof globalCv.Mat === "function") return globalCv;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    const current = window.cv;
    if (!current) continue;
    if (isPromiseLike(current)) {
      const cv = await current;
      if (typeof cv?.Mat === "function") return cv;
      continue;
    }
    if (typeof current.Mat === "function") return current;
  }
  throw new Error("OpenCV runtime initialization timed out");
}

function loadOpenCvScript(): Promise<void> {
  if (window.cv) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-stgy-opencv="true"]',
    );
    if (existing) {
      if (existing.dataset.stgyOpenCvLoaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          existing.remove();
          reject(new Error("OpenCV loader failed"));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = OPENCV_BROWSER_SCRIPT_URL;
    script.async = true;
    script.dataset.stgyOpencv = "true";
    script.addEventListener(
      "load",
      () => {
        script.dataset.stgyOpenCvLoaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("OpenCV loader failed"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
}

export function getOpenCv(): Promise<OpenCvRuntime> {
  if (openCvPromise) return openCvPromise;

  openCvPromise = (async () => {
    if (typeof window === "undefined") throw new Error("OpenCV is only available in the browser");
    await loadOpenCvScript();
    return initializedOpenCvFromGlobal();
  })().catch((error) => {
    openCvPromise = null;
    throw error;
  });

  return openCvPromise;
}

export async function checkOpenCvRuntime(): Promise<string> {
  const cv = await getOpenCv();
  const mat = new cv.Mat();
  try {
    const buildInfo = cv.getBuildInformation?.() ?? "";
    if (buildInfo && !buildInfo.includes(OPENCV_VERSION)) {
      throw new Error(`Unexpected OpenCV build; expected ${OPENCV_VERSION}`);
    }
    return `OpenCV ${OPENCV_VERSION} (@techstark/opencv-js ${OPENCV_PACKAGE_VERSION})`;
  } finally {
    mat.delete();
  }
}
