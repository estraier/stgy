/** Run after the pinned OpenCV source has been patched and npm run build has completed. */
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { assetDir, OPENCV_PACKAGE, OPENCV_PACKAGE_VERSION, OPENCV_VERSION, PANORAMA_ORB_FEATURES, PANORAMA_MATCHER_CONFIDENCE_LIMIT, sha256File, verifyPanoramaOrbWasm } from "./opencv-orb5000-asset.mjs";
import { patchStitcherSource, STITCHER_SOURCE_RELATIVE_PATH } from "./patch-opencv-panorama-orb.mjs";

const sourceDir = process.argv[2] && resolve(process.argv[2]);
if (!sourceDir) {
  console.error("Usage: node frontend/scripts/install-panorama-orb-5000-wasm.mjs <opencv-wasm-clone>");
  process.exit(2);
}
const packageJson = JSON.parse(await readFile(join(sourceDir, "package.json"), "utf8"));
if (packageJson.name !== OPENCV_PACKAGE || packageJson.version !== OPENCV_PACKAGE_VERSION) {
  throw new Error(`Expected ${OPENCV_PACKAGE}@${OPENCV_PACKAGE_VERSION}, got ${packageJson.name}@${packageJson.version}`);
}
const nativeSource = join(sourceDir, "vendor", `opencv-${OPENCV_VERSION}`, STITCHER_SOURCE_RELATIVE_PATH);
const source = await readFile(nativeSource, "utf8");
if (patchStitcherSource(source).changed) {
  throw new Error("OpenCV Stitcher.cpp has not been patched to ORB::create(5000); refusing to install stock WASM.");
}
const compiledWasm = join(sourceDir, "lib", "opencv_js.wasm");
const [nativeStats, wasmStats] = await Promise.all([stat(nativeSource), stat(compiledWasm)]);
if (wasmStats.mtimeMs < nativeStats.mtimeMs) {
  throw new Error("Native OpenCV source was modified after the WASM output; rebuild before installing.");
}
let commit = "unknown";
try { commit = execFileSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
const manifest = {
  schemaVersion: 2,
  package: OPENCV_PACKAGE,
  packageVersion: OPENCV_PACKAGE_VERSION,
  openCvVersion: OPENCV_VERSION,
  panoramaOrbFeatures: PANORAMA_ORB_FEATURES,
  panoramaMatcherConfidenceLimit: PANORAMA_MATCHER_CONFIDENCE_LIMIT,
  wasmSha256: await sha256File(compiledWasm),
  stitcherSourceSha256: await sha256File(nativeSource),
  upstreamCommit: commit,
};
// Stage first, then validate the exact bytes being installed; do not replace
// a previously working binary with an incomplete or damaged output.
const staging = `${assetDir}.staging-${process.pid}`;
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
try {
  await cp(compiledWasm, join(staging, "opencv_js.wasm"));
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await verifyPanoramaOrbWasm({ binary: join(staging, "opencv_js.wasm"), manifestFile: join(staging, "manifest.json") });
  // Preserve a previously installed binary until the new one is complete.
  const backup = `${assetDir}.backup-${process.pid}`;
  await rm(backup, { recursive: true, force: true });
  let hadOld = false;
  try { await rename(assetDir, backup); hadOld = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  try { await rename(staging, assetDir); } catch (error) { if (hadOld) await rename(backup, assetDir); throw error; }
  if (hadOld) await rm(backup, { recursive: true, force: true });
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(`Installed STGY Panorama ORB ${PANORAMA_ORB_FEATURES} WASM: ${assetDir}`);
console.log(`SHA-256: ${manifest.wasmSha256}`);
console.log("Commit frontend/vendor/opencv-orb5000/{opencv_js.wasm,manifest.json} with the other STGY sources.");
