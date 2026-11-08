import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PANORAMA_ORB_FEATURES,
  PANORAMA_MATCHER_CONFIDENCE_LIMIT,
  STITCHER_SOURCE_RELATIVE_PATH,
  STITCHER_HEADER_RELATIVE_PATH,
  patchStitcherFovSource,
  patchStitcherHeader,
  patchStitcherSource,
  patchStitcherFile,
} from "./patch-opencv-panorama-orb.mjs";

const original = `#include "precomp.hpp"
Ptr<Stitcher> Stitcher::create(Mode mode)
{
  stitcher->setFeaturesFinder(ORB::create());
  switch (mode) {
    case PANORAMA:
      stitcher->setFeaturesMatcher(makePtr<detail::BestOf2NearestMatcher>(false));
      break;
    case SCANS:
      stitcher->setFeaturesMatcher(makePtr<detail::AffineBestOf2NearestMatcher>(false, false));
      break;
  }
}
`;
const estimateCamera = `Stitcher::Status Stitcher::estimateCameraParams()
{
    // estimate homography in global frame
    if (!(*estimator_)(features_, pairwise_matches_, cameras_))
        return ERR_HOMOGRAPHY_EST_FAIL;
    bundle_adjuster_->setConfThresh(conf_thresh_);
    if (!(*bundle_adjuster_)(features_, pairwise_matches_, cameras_))
        return ERR_CAMERA_PARAMS_ADJUST_FAIL;
    return OK;
}
`;
const originalWithEstimator = original + estimateCamera;
const headerOriginal = `    CV_WRAP void setPanoConfidenceThresh(double conf_thresh) { conf_thresh_ = conf_thresh; }
    std::vector<int> indices_;
`;
const previousCustom = original.replace("ORB::create()", "ORB::create(5000)");

test("configures 5000 ORB points and raises only Panorama matcher's upper confidence limit", () => {
  const result = patchStitcherSource(original);
  assert.equal(result.changed, true);
  assert.equal(PANORAMA_ORB_FEATURES, 5000);
  assert.equal(PANORAMA_MATCHER_CONFIDENCE_LIMIT, 3.5);
  assert.match(result.source, /ORB::create\(5000\)/);
  assert.match(result.source, /BestOf2NearestMatcher>\(false, 0\.3f, 6, 6, 3\.5\)/);
  assert.match(result.source, /AffineBestOf2NearestMatcher>\(false, false\)/);
  assert.equal(result.source.includes("setWaveCorrection"), false);
});

test("updates the previously built ORB 5000 source without needing a reset", () => {
  const result = patchStitcherSource(previousCustom);
  assert.equal(result.changed, true);
  assert.equal(result.source.match(/ORB::create\(5000\)/g)?.length, 1);
});

test("repeat application is harmless", () => {
  const once = patchStitcherSource(original);
  const twice = patchStitcherSource(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("fails closed on unknown, duplicated, or contradictory upstream code", () => {
  assert.throws(() => patchStitcherSource(original.replace("ORB::create()", "SIFT::create()")), /Unexpected/);
  assert.throws(() => patchStitcherSource(original.replace("BestOf2NearestMatcher>(false)", "BestOf2NearestMatcher>(true)")), /Unexpected/);
  assert.throws(() => patchStitcherSource(original + original), /Unexpected/);
});

test("confidence 3.5 exceeds the mathematical upper bound but stock 3.0 does not", () => {
  const numMatches = 1000;
  const inliers = 950;
  const confidence = inliers / (8 + 0.3 * numMatches);
  assert.ok(confidence > 3.0);
  assert.ok(confidence < PANORAMA_MATCHER_CONFIDENCE_LIMIT);
  assert.ok(1 / 0.3 < PANORAMA_MATCHER_CONFIDENCE_LIMIT);
});

test("adds fixed FoV API and camera optimization exactly once", () => {
  const src1 = patchStitcherFovSource(patchStitcherSource(originalWithEstimator).source);
  assert.equal(src1.changed, true);
  assert.match(src1.source, /HomographyBasedEstimator fixed_estimator\(true\)/);
  assert.match(src1.source, /BundleAdjusterReproj fixed_adjuster/);
  assert.match(src1.source, /cameras_\[i\]\.ppx = 0\.5 \* features_\[i\]\.img_size\.width/);
  assert.match(src1.source, /cameras_\[i\]\.ppy = 0\.5 \* features_\[i\]\.img_size\.height/);
  assert.match(src1.source, /Mat::zeros\(3, 3, CV_8U\)/);
  assert.match(src1.source, /else\s*\{\s*\/\/ estimate homography/);
  const src2 = patchStitcherFovSource(src1.source);
  assert.equal(src2.changed, false);
  assert.equal(src2.source, src1.source);
  const hdr1 = patchStitcherHeader(headerOriginal);
  assert.match(hdr1.source, /CV_WRAP void setStgyFocalLengths/);
  assert.equal(patchStitcherHeader(hdr1.source).changed, false);
});

test("upgrades the previously compiled fixed-FoV branch instead of duplicating it", () => {
  const latest = patchStitcherFovSource(originalWithEstimator).source;
  const old = latest.replace(
    `            cameras_[i].focal = focal;
            // HomographyBasedEstimator(true) requires these principal points
            // to be initialized before estimating the camera rotations.
            cameras_[i].ppx = 0.5 * features_[i].img_size.width;
            cameras_[i].ppy = 0.5 * features_[i].img_size.height;
            cameras_[i].aspect = 1.0;`,
    `            cameras_[i].focal = focal;`,
  );
  assert.equal(old.includes("cameras_[i].ppx"), false);
  const result = patchStitcherFovSource(old);
  assert.equal(result.changed, true);
  assert.equal(result.source, latest);
  assert.equal(patchStitcherFovSource(result.source).changed, false);
});

test("writes the two named upstream C++ files and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "stgy-panorama-orb-"));
  try {
    const path = join(root, STITCHER_SOURCE_RELATIVE_PATH);
    const header = join(root, STITCHER_HEADER_RELATIVE_PATH);
    await mkdir(join(root, "modules/stitching/src"), { recursive: true });
    await mkdir(join(root, "modules/stitching/include/opencv2"), { recursive: true });
    await writeFile(path, originalWithEstimator.replace("ORB::create()", "ORB::create(5000)"));
    await writeFile(header, headerOriginal);
    const first = await patchStitcherFile(root);
    assert.equal(first.changed, true);
    assert.equal(first.filename, path);
    assert.equal(first.headerFile, header);
    assert.match(await readFile(path, "utf8"), /0\.3f, 6, 6, 3\.5/);
    assert.match(await readFile(header, "utf8"), /setStgyFocalLengths/);
    assert.equal((await patchStitcherFile(root)).changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
