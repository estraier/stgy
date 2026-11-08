import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PANORAMA_ORB_FEATURES,
  PANORAMA_MATCHER_CONFIDENCE_LIMIT,
  STITCHER_SOURCE_RELATIVE_PATH,
  patchStitcherSource,
  patchStitcherFile,
} from "./patch-opencv-panorama-orb.mjs";

const original = `Ptr<Stitcher> Stitcher::create(Mode mode)
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

test("writes only the named upstream C++ file", async () => {
  const root = await mkdtemp(join(tmpdir(), "stgy-panorama-orb-"));
  try {
    const path = join(root, STITCHER_SOURCE_RELATIVE_PATH);
    await mkdir(join(root, "modules/stitching/src"), { recursive: true });
    await writeFile(path, previousCustom);
    const first = await patchStitcherFile(root);
    assert.deepEqual(first, { filename: path, changed: true });
    assert.match(await readFile(path, "utf8"), /0\.3f, 6, 6, 3\.5/);
    assert.equal((await patchStitcherFile(root)).changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
