// Patch the native OpenCV 5 stitching source before rebuilding @banou/opencv-wasm.
// The stock WASM exposes numeric Stitcher settings, but not setFeaturesFinder().
// Changing the application's ORB constructor cannot change Stitcher's native ORB.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const PANORAMA_ORB_FEATURES = 5000;
export const STITCHER_SOURCE_RELATIVE_PATH = "modules/stitching/src/stitcher.cpp";

const STOCK_CALL = "stitcher->setFeaturesFinder(ORB::create());";
const UPDATED_CALL = `stitcher->setFeaturesFinder(ORB::create(${PANORAMA_ORB_FEATURES}));`;

/** Return the modified source, or report that it is already patched. */
export function patchStitcherSource(source) {
  const alreadyPatched = source.includes(UPDATED_CALL);
  const stock = source.includes(STOCK_CALL);
  if (alreadyPatched && !stock) {
    return { source, changed: false };
  }
  if (!stock || alreadyPatched || source.split(STOCK_CALL).length !== 2) {
    throw new Error(
      "Unexpected OpenCV Stitcher::create() source; refusing to change ORB configuration. "
      + "Check the pinned OpenCV version and its feature-finder initialization.",
    );
  }
  return { source: source.replace(STOCK_CALL, UPDATED_CALL), changed: true };
}

export async function patchStitcherFile(sourceRoot) {
  const filename = join(resolve(sourceRoot), STITCHER_SOURCE_RELATIVE_PATH);
  const source = await readFile(filename, "utf8");
  const result = patchStitcherSource(source);
  if (result.changed) await writeFile(filename, result.source, "utf8");
  return { filename, changed: result.changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) {
    console.error("Usage: node frontend/scripts/patch-opencv-panorama-orb.mjs <OpenCV-source-root>");
    process.exitCode = 2;
  } else {
    try {
      const { filename, changed } = await patchStitcherFile(sourceRoot);
      console.log(`${changed ? "Patched" : "Already patched"}: ${filename} (ORB nfeatures=${PANORAMA_ORB_FEATURES})`);
      console.log("Build the native WASM and vendor it into STGY with build-panorama-orb-5000-wasm.sh.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
