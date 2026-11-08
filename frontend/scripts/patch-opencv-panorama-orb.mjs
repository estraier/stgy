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
export const STITCHER_HEADER_RELATIVE_PATH = "modules/stitching/include/opencv2/stitching.hpp";
export const PANORAMA_FIXED_FOV_API = "setStgyFocalLengths";

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

// Unlike replaceOnce(), the new insertion includes its anchor unchanged.
// Recognize that exact full insertion before considering the anchor.
function insertOnce(source, anchor, insertion, label) {
  if (source.includes(insertion)) return { source, changed: false };
  if (source.split(anchor).length !== 2) {
    throw new Error(`Unexpected OpenCV 5.0.0 ${label}; refusing to patch.`);
  }
  return { source: source.replace(anchor, insertion), changed: true };
}

/** Patch both the stock source and the previously shipped ORB=5000 source. */
export function patchStitcherSource(source) {
  const features = replaceOnce(source, STOCK_FEATURES, CUSTOM_FEATURES, "ORB");
  const matcher = replaceOnce(features.source, STOCK_MATCHER, CUSTOM_MATCHER, "Panorama matcher");
  return { source: matcher.source, changed: features.changed || matcher.changed };
}

const STGY_FOV_SETTER = `    // Values are full input-proxy pixels, ordered by original image index.
    CV_WRAP void setStgyFocalLengths(const std::vector<double>& focals) { stgy_focal_lengths_ = focals; }
`;
const STGY_FOV_MEMBER = `    std::vector<double> stgy_focal_lengths_;\n`;
const STGY_FIXED_FOV_ESTIMATION = `    // STGY: preserve the existing estimator + Ray BA exactly for Estimate.
    // In fixed-FoV mode, use the supplied intrinsics BEFORE rotation estimation
    // and optimize rotations only. Reproj honors an all-zero intrinsics mask;
    // Ray ignores that mask and therefore cannot be used here.
    if (!stgy_focal_lengths_.empty())
    {
        CV_Assert(stgy_focal_lengths_.size() >= 2);
        cameras_.assign(features_.size(), detail::CameraParams());
        for (size_t i = 0; i < features_.size(); ++i)
        {
            const int original_index = indices_[i];
            CV_Assert(original_index >= 0 && (size_t)original_index < stgy_focal_lengths_.size());
            const double focal = stgy_focal_lengths_[original_index] * work_scale_;
            CV_Assert(std::isfinite(focal) && focal > 0);
            cameras_[i].focal = focal;
            // HomographyBasedEstimator(true) requires these principal points
            // to be initialized before estimating the camera rotations.
            cameras_[i].ppx = 0.5 * features_[i].img_size.width;
            cameras_[i].ppy = 0.5 * features_[i].img_size.height;
            cameras_[i].aspect = 1.0;
        }
        detail::HomographyBasedEstimator fixed_estimator(true);
        if (!fixed_estimator(features_, pairwise_matches_, cameras_))
            return ERR_HOMOGRAPHY_EST_FAIL;
        for (size_t i = 0; i < cameras_.size(); ++i)
            cameras_[i].R.convertTo(cameras_[i].R, CV_32F);
        detail::BundleAdjusterReproj fixed_adjuster;
        fixed_adjuster.setConfThresh(conf_thresh_);
        fixed_adjuster.setRefinementMask(Mat::zeros(3, 3, CV_8U));
        fixed_adjuster.setTermCriteria(TermCriteria(TermCriteria::COUNT + TermCriteria::EPS, 100, 1e-4));
        if (!fixed_adjuster(features_, pairwise_matches_, cameras_))
            return ERR_CAMERA_PARAMS_ADJUST_FAIL;
    }
    else
    {
`;
const STGY_FIXED_FOV_CLOSE = `    }\n`;

export function patchStitcherHeader(source) {
  let result = insertOnce(
    source,
    "    CV_WRAP void setPanoConfidenceThresh(double conf_thresh) { conf_thresh_ = conf_thresh; }\n",
    "    CV_WRAP void setPanoConfidenceThresh(double conf_thresh) { conf_thresh_ = conf_thresh; }\n" + STGY_FOV_SETTER,
    "STGY fixed FoV setter",
  );
  const member = insertOnce(
    result.source,
    "    std::vector<int> indices_;\n",
    "    std::vector<int> indices_;\n" + STGY_FOV_MEMBER,
    "STGY fixed FoV member",
  );
  return { source: member.source, changed: result.changed || member.changed };
}

export function patchStitcherFovSource(source) {
  // Users may have the previously built fixed-FoV OpenCV source in place.
  // Update that exact old block rather than skipping it or inserting twice.
  const oldBlock = STGY_FIXED_FOV_ESTIMATION.replace(
    `            cameras_[i].focal = focal;
            // HomographyBasedEstimator(true) requires these principal points
            // to be initialized before estimating the camera rotations.
            cameras_[i].ppx = 0.5 * features_[i].img_size.width;
            cameras_[i].ppy = 0.5 * features_[i].img_size.height;
            cameras_[i].aspect = 1.0;`,
    `            cameras_[i].focal = focal;`,
  );
  let updatedLegacy = false;
  if (source.includes(oldBlock)) {
    if (source.split(oldBlock).length !== 2) throw new Error("Duplicate legacy STGY fixed-FoV estimator block.");
    source = source.replace(oldBlock, STGY_FIXED_FOV_ESTIMATION);
    updatedLegacy = true;
  }
  let result = insertOnce(source, '#include "precomp.hpp"\n', '#include "precomp.hpp"\n#include <cmath>\n', "FoV cmath include");
  result = insertOnce(
    result.source,
    "    // estimate homography in global frame\n    if (!(*estimator_)(features_, pairwise_matches_, cameras_))",
    STGY_FIXED_FOV_ESTIMATION + "    // estimate homography in global frame\n    if (!(*estimator_)(features_, pairwise_matches_, cameras_))",
    "fixed FoV estimator",
  );
  const after = insertOnce(
    result.source,
    "    bundle_adjuster_->setConfThresh(conf_thresh_);\n    if (!(*bundle_adjuster_)(features_, pairwise_matches_, cameras_))\n        return ERR_CAMERA_PARAMS_ADJUST_FAIL;",
    "    bundle_adjuster_->setConfThresh(conf_thresh_);\n    if (!(*bundle_adjuster_)(features_, pairwise_matches_, cameras_))\n        return ERR_CAMERA_PARAMS_ADJUST_FAIL;\n" + STGY_FIXED_FOV_CLOSE,
    "fixed FoV estimator close",
  );
  return { source: after.source, changed: updatedLegacy || result.changed || after.changed };
}

export async function patchStitcherFile(sourceRoot) {
  const filename = join(resolve(sourceRoot), STITCHER_SOURCE_RELATIVE_PATH);
  const source = await readFile(filename, "utf8");
  const orb = patchStitcherSource(source);
  const result = patchStitcherFovSource(orb.source);
  const headerFile = join(resolve(sourceRoot), STITCHER_HEADER_RELATIVE_PATH);
  const header = await readFile(headerFile, "utf8");
  const patchedHeader = patchStitcherHeader(header);
  // Validate both source transformations before writing either file.
  if (result.changed) await writeFile(filename, result.source, "utf8");
  if (patchedHeader.changed) await writeFile(headerFile, patchedHeader.source, "utf8");
  return { filename, headerFile, changed: orb.changed || result.changed || patchedHeader.changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) {
    console.error("Usage: node frontend/scripts/patch-opencv-panorama-orb.mjs <OpenCV-source-root>");
    process.exitCode = 2;
  } else {
    try {
      const { filename, changed } = await patchStitcherFile(sourceRoot);
      console.log(`${changed ? "Patched" : "Already patched"}: ${filename} (ORB=${PANORAMA_ORB_FEATURES}, matcher confidence upper limit=${PANORAMA_MATCHER_CONFIDENCE_LIMIT}, fixed FoV API)`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
