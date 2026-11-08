// Patch OpenCV 5.0.0's Panorama Stitcher for STGY's custom WASM.
// Stock BestOf2NearestMatcher discards pairs with confidence > 3.0, which
// can reject genuinely overlapping images after raising ORB to 5000 points.
// The confidence formula has an upper bound of 1 / 0.3 = 3.333..., so 3.5
// disables only this high-confidence suppression. It does NOT reduce the
// minimum panorama graph-confidence threshold or change RANSAC geometry.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const PANORAMA_ORB_FEATURES = 5000;
export const PANORAMA_MATCHER_CONFIDENCE_LIMIT = 3.5;
export const STITCHER_SOURCE_RELATIVE_PATH = "modules/stitching/src/stitcher.cpp";

const STOCK_FEATURES = "stitcher->setFeaturesFinder(ORB::create());";
const CUSTOM_FEATURES = `stitcher->setFeaturesFinder(ORB::create(${PANORAMA_ORB_FEATURES}));`;
const STOCK_MATCHER = "stitcher->setFeaturesMatcher(makePtr<detail::BestOf2NearestMatcher>(false));";
const CUSTOM_MATCHER =
  `stitcher->setFeaturesMatcher(makePtr<detail::BestOf2NearestMatcher>(false, 0.3f, 6, 6, ${PANORAMA_MATCHER_CONFIDENCE_LIMIT}));`;

function replaceOnce(source, stock, custom, label) {
  const stockCount = source.split(stock).length - 1;
  const customCount = source.split(custom).length - 1;
  if (stockCount === 0 && customCount === 1) return { source, changed: false };
  if (stockCount === 1 && customCount === 0) {
    return { source: source.replace(stock, custom), changed: true };
  }
  throw new Error(`Unexpected OpenCV 5.0.0 ${label} initialization; refusing to patch. Check the pinned source.`);
}

/** Patch both the stock source and the previously shipped ORB=5000 source. */
export function patchStitcherSource(source) {
  const features = replaceOnce(source, STOCK_FEATURES, CUSTOM_FEATURES, "ORB");
  const matcher = replaceOnce(features.source, STOCK_MATCHER, CUSTOM_MATCHER, "Panorama matcher");
  return { source: matcher.source, changed: features.changed || matcher.changed };
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
      console.log(`${changed ? "Patched" : "Already patched"}: ${filename} (ORB=${PANORAMA_ORB_FEATURES}, matcher confidence upper limit=${PANORAMA_MATCHER_CONFIDENCE_LIMIT})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
