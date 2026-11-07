import { loadOpenCvNative, type NativeOpenCvModule } from "./opencv-native";

export const OPENCV_PACKAGE_VERSION = "0.0.6";
export const OPENCV_VERSION = "5.0.0";
export const OPENCV_BROWSER_SCRIPT_URL = "/vendor/opencv/lib/index.js";

export type OpenCvRuntime = NativeOpenCvModule & {
  getBuildInformation?: () => string;
};

export async function getOpenCv(): Promise<OpenCvRuntime> {
  if (typeof window === "undefined") throw new Error("OpenCV is only available in the browser");
  return loadOpenCvNative() as Promise<OpenCvRuntime>;
}

export async function checkOpenCvRuntime(): Promise<string> {
  const cv = await getOpenCv();
  const mat = new cv.Mat();
  try {
    const buildInfo = cv.getBuildInformation?.() ?? "";
    if (buildInfo && !buildInfo.includes(OPENCV_VERSION)) {
      throw new Error(`Unexpected OpenCV build; expected ${OPENCV_VERSION}`);
    }
    return `OpenCV ${OPENCV_VERSION} (@banou/opencv-wasm ${OPENCV_PACKAGE_VERSION})`;
  } finally {
    mat.delete();
  }
}
