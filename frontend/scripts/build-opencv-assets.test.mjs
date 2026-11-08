import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceScripts = dirname(fileURLToPath(import.meta.url));
async function withFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), "stgy-opencv-assets-"));
  const scripts = join(root, "frontend/scripts");
  const packageDir = join(root, "node_modules/@banou/opencv-wasm");
  const lib = join(packageDir, "lib");
  const vendored = join(root, "frontend/vendor/opencv-orb5000");
  const customLib = join(vendored, "lib");
  const deployed = join(root, "frontend/public/vendor/opencv");
  const stock = Buffer.alloc(2048);
  const custom = Buffer.alloc(2048);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(stock);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(custom);
  custom[100] = 0x50;
  await mkdir(scripts, { recursive: true });
  await mkdir(lib, { recursive: true });
  await mkdir(customLib, { recursive: true });
  await mkdir(deployed, { recursive: true });
  await cp(join(sourceScripts, "build-opencv-assets.mjs"), join(scripts, "build-opencv-assets.mjs"));
  await cp(join(sourceScripts, "opencv-orb5000-asset.mjs"), join(scripts, "opencv-orb5000-asset.mjs"));
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "@banou/opencv-wasm", version: "0.0.6" }));
  await writeFile(join(lib, "index.js"), "export const test = 1;\n");
  await writeFile(join(lib, "opencv_js.wasm"), stock);
  await writeFile(join(vendored, "opencv_js.wasm"), custom);
  const customJs = "export const customBinding = true;\n";
  await writeFile(join(customLib, "index.js"), customJs);
  const sha256 = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = {
    schemaVersion: 4,
    fixedPanoramaFovApi: "setStgyFocalLengths",
    stitcherHeaderSha256: "0".repeat(64),
    customJsSha256: sha256(Buffer.from(customJs)),
    package: "@banou/opencv-wasm", packageVersion: "0.0.6", openCvVersion: "5.0.0",
    panoramaOrbFeatures: 5000, panoramaMatcherConfidenceLimit: 3.5, stitcherSourceSha256: "0".repeat(64), wasmSha256: sha256(custom),
  };
  await writeFile(join(vendored, "manifest.json"), JSON.stringify(manifest));
  try { await callback({ scripts, deployed, vendored, stock, custom }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("copies npm JS but substitutes and identifies the custom ORB=5000 native binary", async () => withFixture(async (f) => {
  const run = spawnSync(process.execPath, [join(f.scripts, "build-opencv-assets.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(await readFile(join(f.deployed, "lib/opencv_js.wasm")), f.custom);
  assert.equal(await readFile(join(f.deployed, "lib/index.js"), "utf8"), "export const customBinding = true;\n");
  assert.match(await readFile(join(f.deployed, "VERSION"), "utf8"), /Panorama Stitcher ORB max features: 5000/);
}));

test("refuses a missing native override without destroying previously deployed assets", async () => withFixture(async (f) => {
  const oldFile = join(f.deployed, "VERSION");
  await writeFile(oldFile, "previous successful version");
  await rm(join(f.vendored, "manifest.json"));
  const run = spawnSync(process.execPath, [join(f.scripts, "build-opencv-assets.mjs")], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Missing STGY Panorama ORB 5000 WASM manifest/);
  assert.equal(await readFile(oldFile, "utf8"), "previous successful version");
}));
