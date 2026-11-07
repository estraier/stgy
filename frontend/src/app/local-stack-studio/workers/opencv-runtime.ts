// Shared OpenCV bootstrap for Local Stack Studio workers.
import { loadOpenCvNative } from "../../../image/opencv-native";

// The package has a generated native API; STGY worker algorithms retain their
// previous dynamic boundary until their per-operation signatures are migrated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenCvDynamic = any;
export type OpenCvRuntime = { Mat: OpenCvDynamic; [key: string]: OpenCvDynamic };

export async function loadWorkerOpenCv(workerLabel: string): Promise<OpenCvRuntime> {
  try {
    return await loadOpenCvNative() as OpenCvRuntime;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to load native OpenCV in the ${workerLabel} worker${detail}`);
  }
}
