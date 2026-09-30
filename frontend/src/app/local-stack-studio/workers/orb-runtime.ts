import { AlignmentImplementationError } from "./alignment-error";
import type { OpenCvDynamic, OpenCvRuntime } from "./opencv-runtime";

export const ORB_MAX_FEATURES = 5000;

export function createConfiguredOrb(cv: OpenCvRuntime): OpenCvDynamic {
  if (typeof cv.ORB !== "function") {
    throw new AlignmentImplementationError(
      "This OpenCV.js build does not provide the cv.ORB constructor required by STGY.",
    );
  }

  let instance: OpenCvDynamic;
  try {
    // @techstark/opencv-js@5.0.0-release.1 exposes ORB as a constructor whose
    // first argument is nfeatures. Pass the configured limit at construction
    // time instead of probing optional create()/setMaxFeatures() APIs.
    instance = new cv.ORB(ORB_MAX_FEATURES);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new AlignmentImplementationError(
      `Failed to construct cv.ORB with nfeatures=${ORB_MAX_FEATURES}${detail}`,
    );
  }

  if (
    !instance ||
    typeof instance.detectAndCompute !== "function" ||
    typeof instance.delete !== "function"
  ) {
    try {
      instance?.delete?.();
    } catch {}
    throw new AlignmentImplementationError(
      "The cv.ORB constructor returned an object without detectAndCompute()/delete().",
    );
  }
  return instance;
}
