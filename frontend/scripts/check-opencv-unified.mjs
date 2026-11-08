/**
 * Execute on a machine with frontend/node_modules installed:
 *   npm run check:opencv
 *
 * This exercises the exact native package that is copied into public/vendor.
 * It deliberately tests native numerical operations instead of treating
 * the presence of a symbol as proof of OpenCV.js compatibility.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path";
import { wasmPath, verifyPanoramaOrbWasm } from "./opencv-orb5000-asset.mjs";

const require = createRequire(import.meta.url);
const { version, name } = require("@banou/opencv-wasm/package.json");
assert.equal(name, "@banou/opencv-wasm");
assert.equal(version, "0.0.6");
// Exercise the exact vendored binary that will ship to browsers, not the
// untouched default binary in node_modules.
const packageLib = join(dirname(require.resolve("@banou/opencv-wasm/package.json")), "lib", "opencv_js.wasm");
const manifest = await verifyPanoramaOrbWasm({ stockBinary: packageLib });
assert.equal(manifest.panoramaOrbFeatures, 5000);
const cv = await import("@banou/opencv-wasm");
await cv.initOpenCV({ wasmBinary: new Uint8Array(await readFile(wasmPath)) });

const functions = [
  "Mat", "matFromArray", "resize", "cvtColor", "GaussianBlur", "Sobel", "Laplacian",
  "pyrDown", "pyrUp", "bilateralFilter", "createCLAHE", "findTransformECC",
  "ORB", "BFMatcher", "KeyPointVector", "DMatchVector",
  "warpPerspective", "Stitcher", "PyRotationWarper", "detail_waveCorrect",
];
const constants = [
  "CV_8UC1", "CV_8UC4", "CV_32F", "CV_32FC1", "CV_32FC3", "CV_64F",
  "INTER_AREA", "INTER_LINEAR", "BORDER_REPLICATE", "BORDER_DEFAULT",
  "NORM_HAMMING", "MOTION_AFFINE",
  "detail_WAVE_CORRECT_AUTO", "detail_WAVE_CORRECT_HORIZ", "detail_WAVE_CORRECT_VERT",
];
// Report all missing exports in one invocation, so migration failures are
// actionable without repeatedly fixing one missing name at a time.
const missing = [
  ...functions.filter((key) => typeof cv[key] !== "function").map((key) => `${key} (function/class)`),
  ...constants.filter((key) => typeof cv[key] !== "number").map((key) => `${key} (constant)`),
];
assert.deepEqual(missing, [], `Missing required native OpenCV exports: ${missing.join(", ")}`);

const resources = [];
const owned = (value) => { assert.ok(value); resources.push(value); return value; };
try {
  const width = 160, height = 128;
  const pixels = Uint8Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    return (x * 73 + y * 29 + (x * y) % 251 + ((x ^ y) * 17)) & 255;
  });
  const source = owned(cv.matFromArray(height, width, cv.CV_8UC1, pixels));
  const independent = owned(source.mat_clone());
  assert.equal(independent.data[4], pixels[4]);
  const oldValue = source.data[4];
  independent.data[4] ^= 0xff;
  assert.equal(source.data[4], oldValue, "Native Mat clone must copy pixels");
  const small = owned(new cv.Mat());
  cv.resize(source, small, { width: 80, height: 64 }, 0, 0, cv.INTER_AREA);
  assert.equal(small.cols, 80);
  const blur = owned(new cv.Mat());
  cv.GaussianBlur(source, blur, { width: 3, height: 3 }, 0, 0, cv.BORDER_DEFAULT);
  const down = owned(new cv.Mat());
  cv.pyrDown(source, down, { width: 80, height: 64 });
  assert.equal(down.rows, 64);
  const up = owned(new cv.Mat());
  cv.pyrUp(down, up, { width, height });
  assert.equal(up.rows, height);
  const bilateral = owned(new cv.Mat());
  cv.bilateralFilter(source, bilateral, 5, 20, 10, cv.BORDER_DEFAULT);
  const sobel = owned(new cv.Mat());
  const laplacian = owned(new cv.Mat());
  cv.Sobel(source, sobel, cv.CV_32F, 1, 0, 3);
  cv.Laplacian(source, laplacian, cv.CV_32F, 3);
  assert.ok(sobel.data32F.some((x) => x !== 0));
  const clahe = owned(cv.createCLAHE(1, { width: 8, height: 8 }));
  const enhanced = owned(new cv.Mat());
  clahe.apply(source, enhanced);
  assert.equal(enhanced.data.length, pixels.length);

  const orb = owned(cv.ORB.create(5000));
  const matcher = owned(new cv.BFMatcher(cv.NORM_HAMMING, true));
  const mask = owned(new cv.Mat());
  const kp1 = owned(new cv.KeyPointVector());
  const kp2 = owned(new cv.KeyPointVector());
  const d1 = owned(new cv.Mat());
  const d2 = owned(new cv.Mat());
  const matches = owned(new cv.DMatchVector());
  orb.detectAndCompute(source, mask, kp1, d1);
  orb.detectAndCompute(source, mask, kp2, d2);
  assert.ok(kp1.size() > 0, "ORB found no feature points");
  matcher.match(d1, d2, matches);
  assert.ok(matches.size() > 0, "BFMatcher returned no matches");
  const keypoint = kp1.get(0);
  try { assert.ok(Number.isFinite(keypoint.pt.x)); } finally { keypoint.delete?.(); }
  const match = matches.get(0);
  try { assert.ok(Number.isFinite(match.distance)); } finally { match.delete?.(); }

  const warp = owned(cv.matFromArray(2, 3, cv.CV_32F, [1, 0, 0, 0, 1, 0]));
  // TermCriteria is a value object in the native binding (not a runtime
  // constructor). OpenCV defines COUNT=1, EPS=2; the exact maxCount/epsilon
  // values are the ones used by the STGY ECC worker.
  const criteria = { type: 1 | 2, maxCount: 15, epsilon: 1e-4 };
  const quality = cv.findTransformECC(source, source, warp, cv.MOTION_AFFINE, criteria, mask, 5);
  assert.ok(Number.isFinite(quality) && quality > 0.99, `Unexpected ECC identity correlation: ${quality}`);
  const perspective = owned(cv.matFromArray(3, 3, cv.CV_64F, [1, 0, 0, 0, 1, 0, 0, 0, 1]));
  const warped = owned(new cv.Mat());
  cv.warpPerspective(source, warped, perspective, { width, height }, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  assert.equal(warped.data[4], source.data[4]);
  const stitcher = owned(cv.Stitcher.create(0));
  assert.equal(typeof stitcher.estimateTransform, "function");
  assert.equal(typeof stitcher.cameras, "function");
  console.log("OpenCV unified WASM: native matrix, blur, pyramid, CLAHE, ORB, matcher, ECC, warp and Stitcher passed.");
} finally {
  for (const handle of resources.reverse()) handle.delete?.();
}
