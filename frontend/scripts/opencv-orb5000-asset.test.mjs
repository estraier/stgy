import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPanoramaOrbWasm, sha256File } from "./opencv-orb5000-asset.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "stgy-orb5000-"));
  const binary = join(root, "opencv_js.wasm");
  const manifestFile = join(root, "manifest.json");
  const stockBinary = join(root, "stock.wasm");
  const customJs = join(root, "index.js");
  // Small but structurally valid mock WASM; no native execution in this test.
  const bytes = Buffer.alloc(2048);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(bytes);
  bytes[100] = 42;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const jsContent = "export const customBinding = true;\n";
  const manifest = {
    schemaVersion: 4,
    fixedPanoramaFovApi: "setStgyFocalLengths",
    stitcherHeaderSha256: "0".repeat(64),
    customJsSha256: createHash("sha256").update(jsContent).digest("hex"), package: "@banou/opencv-wasm", packageVersion: "0.0.6",
    openCvVersion: "5.0.0", panoramaOrbFeatures: 5000, panoramaMatcherConfidenceLimit: 3.5,
    stitcherSourceSha256: "0".repeat(64), wasmSha256: hash,
  };
  await writeFile(customJs, jsContent);
  await writeFile(binary, bytes);
  await writeFile(stockBinary, Buffer.from(bytes.map((v, i) => i === 100 ? 44 : v)));
  const writeManifest = () => writeFile(manifestFile, JSON.stringify(manifest));
  try { await writeManifest(); await fn({ binary, manifestFile, stockBinary, customJs, manifest, writeManifest }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("validates expected custom WASM with SHA and stock comparison", async () => fixture(async (f) => {
  assert.equal((await verifyPanoramaOrbWasm(f)).panoramaOrbFeatures, 5000);
  assert.equal(await sha256File(f.binary), f.manifest.wasmSha256);
}));
test("rejects metadata that would silently return to stock ORB", async () => fixture(async (f) => {
  f.manifest.panoramaOrbFeatures = 500;
  await f.writeManifest();
  await assert.rejects(verifyPanoramaOrbWasm(f), /Unexpected Panorama ORB/);
}));
test("rejects tampered native output", async () => fixture(async (f) => {
  await writeFile(f.binary, Buffer.alloc(2048));
  await assert.rejects(verifyPanoramaOrbWasm(f), /Invalid WASM header/);
}));
test("rejects changed native content even with intact header", async () => fixture(async (f) => {
  const b = Buffer.alloc(2048);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(b);
  await writeFile(f.binary, b);
  await assert.rejects(verifyPanoramaOrbWasm(f), /SHA-256 mismatch/);
}));
test("rejects byte-identical stock WASM", async () => fixture(async (f) => {
  await writeFile(f.stockBinary, await (await import("node:fs/promises")).readFile(f.binary));
  await assert.rejects(verifyPanoramaOrbWasm(f), /byte-identical to stock/);
}));
test("reports missing committed custom binary", async () => fixture(async (f) => {
  await rm(f.binary);
  await assert.rejects(verifyPanoramaOrbWasm(f), /Missing STGY Panorama ORB 5000 WASM/);
}));

test("rejects old WASM manifest without the high-confidence matching fix", async () => fixture(async (f) => {
  delete f.manifest.panoramaMatcherConfidenceLimit;
  f.manifest.schemaVersion = 1;
  await f.writeManifest();
  await assert.rejects(verifyPanoramaOrbWasm(f), /Unexpected Panorama ORB/);
}));

test("rejects wrong custom ESM even if the WASM hash matches", async () => fixture(async (f) => {
  await writeFile(f.customJs, "export const customBinding = false;\n");
  await assert.rejects(verifyPanoramaOrbWasm(f), /ESM SHA-256 mismatch/);
}));
