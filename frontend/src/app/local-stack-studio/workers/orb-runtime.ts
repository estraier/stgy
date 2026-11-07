import { AlignmentImplementationError } from "./alignment-error";
import type { OpenCvDynamic, OpenCvRuntime } from "./opencv-runtime";

export const ORB_MAX_FEATURES = 5000;

export function createConfiguredOrb(cv: OpenCvRuntime): OpenCvDynamic {
  if (typeof cv.ORB?.create !== "function") {
    throw new AlignmentImplementationError(
      "The native OpenCV build does not provide cv.ORB.create().",
    );
  }

  let instance: OpenCvDynamic;
  try {
    // @banou/opencv-wasm exposes OpenCV's ORB factory. Keep STGY's
    // existing normal-alignment feature count; Panorama is unchanged.
    instance = cv.ORB.create(ORB_MAX_FEATURES);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new AlignmentImplementationError(
      `Failed to create cv.ORB with nfeatures=${ORB_MAX_FEATURES}${detail}`,
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
      "cv.ORB.create() returned an object without detectAndCompute()/delete().",
    );
  }
  return instance;
}
