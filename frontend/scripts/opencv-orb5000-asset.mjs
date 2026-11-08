/**
 * Integrity checks for STGY's locally built Panorama ORB=5000 WASM.
 * The fixed-FoV API requires matching generated ESM + WASM assets. Both are
 * stored under frontend/vendor so npm ci and CI builds stay reproducible
 * without Docker or OpenCV source.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCV_PACKAGE = "@banou/opencv-wasm";
export const OPENCV_PACKAGE_VERSION = "0.0.6";
export const PANORAMA_ORB_FEATURES = 5000;
export const PANORAMA_MATCHER_CONFIDENCE_LIMIT = 3.5;
export const OPENCV_VERSION = "5.0.0";
export const FIXED_PANORAMA_FOV_API = "setStgyFocalLengths";
export const assetDir = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "opencv-orb5000");
export const wasmPath = join(assetDir, "opencv_js.wasm");
export const manifestPath = join(assetDir, "manifest.json");
export const customLibDir = join(assetDir, "lib");

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest("hex");
}

export async function verifyPanoramaOrbWasm({ binary = wasmPath, manifestFile = manifestPath, customJs = join(customLibDir, "index.js"), stockBinary } = {}) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing STGY Panorama ORB 5000 WASM manifest: ${manifestFile}. Run bash frontend/scripts/build-panorama-orb-5000-wasm.sh ../opencv-wasm, and retain frontend/vendor/opencv-orb5000/ in the STGY source.`);
    }
    throw error;
  }
  if (manifest.schemaVersion !== 4 || manifest.fixedPanoramaFovApi !== FIXED_PANORAMA_FOV_API || manifest.package !== OPENCV_PACKAGE ||
      manifest.packageVersion !== OPENCV_PACKAGE_VERSION ||
      manifest.openCvVersion !== OPENCV_VERSION ||
      manifest.panoramaOrbFeatures !== PANORAMA_ORB_FEATURES ||
      manifest.panoramaMatcherConfidenceLimit !== PANORAMA_MATCHER_CONFIDENCE_LIMIT ||
      !/^[0-9a-f]{64}$/.test(manifest.wasmSha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(manifest.stitcherSourceSha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(manifest.stitcherHeaderSha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(manifest.customJsSha256 ?? "")) {
    throw new Error(`Unexpected Panorama ORB 5000 WASM manifest: ${manifestFile}`);
  }
  let size;
  let fd;
  try {
    size = (await stat(binary)).size;
    fd = await open(binary, "r");
    const magic = Buffer.alloc(8);
    const { bytesRead } = await fd.read(magic, 0, 8, 0);
    if (bytesRead !== 8 || !magic.equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
      throw new Error("Invalid WASM header (expected binary WebAssembly version 1)");
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing STGY Panorama ORB 5000 WASM: ${binary}. Rebuild using frontend/scripts/build-panorama-orb-5000-wasm.sh.`);
    }
    throw error;
  } finally {
    await fd?.close();
  }
  if (size < 1024) throw new Error(`Unexpectedly small OpenCV WASM (${size} bytes): ${binary}`);
  const actualHash = await sha256File(binary);
  if (actualHash !== manifest.wasmSha256) {
    throw new Error(`STGY Panorama ORB 5000 WASM SHA-256 mismatch: ${binary}`);
  }
  const jsModule = customJs;
  try { await stat(jsModule); } catch {
    throw new Error(`Missing custom OpenCV ESM bindings: ${jsModule}; rebuild the native package first.`);
  }
  if (await sha256File(jsModule) !== manifest.customJsSha256) {
    throw new Error(`STGY Panorama FoV ESM SHA-256 mismatch: ${jsModule}`);
  }
  if (stockBinary && actualHash === await sha256File(stockBinary)) {
    throw new Error("The vendored WASM is byte-identical to stock @banou/opencv-wasm; the ORB 5000 native patch was not included.");
  }
  return manifest;
}
