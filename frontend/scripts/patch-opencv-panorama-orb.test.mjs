import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PANORAMA_ORB_FEATURES,
  STITCHER_SOURCE_RELATIVE_PATH,
  patchStitcherSource,
  patchStitcherFile,
} from "./patch-opencv-panorama-orb.mjs";

const original = `Ptr<Stitcher> Stitcher::create(Mode mode)\n{\n  stitcher->setFeaturesFinder(ORB::create());\n  stitcher->setWaveCorrection(true);\n}\n`;

test("only switches the native panorama ORB count to 5000", () => {
  const result = patchStitcherSource(original);
  assert.equal(result.changed, true);
  assert.equal(PANORAMA_ORB_FEATURES, 5000);
  assert.equal(
    result.source,
    original.replace("ORB::create()", "ORB::create(5000)"),
  );
});

test("repeat application is harmless", () => {
  const once = patchStitcherSource(original);
  const twice = patchStitcherSource(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test("does not rewrite unknown OpenCV sources", () => {
  assert.throws(() => patchStitcherSource("stitcher->setFeaturesFinder(SIFT::create());"), /Unexpected/);
  assert.throws(() => patchStitcherSource(original + original), /Unexpected/);
});

test("applies the change only to the named upstream source file", async () => {
  const root = await mkdtemp(join(tmpdir(), "stgy-panorama-orb-"));
  try {
    const path = join(root, STITCHER_SOURCE_RELATIVE_PATH);
    await mkdir(join(root, "modules/stitching/src"), { recursive: true });
    await writeFile(path, original);
    const first = await patchStitcherFile(root);
    assert.deepEqual(first, { filename: path, changed: true });
    assert.match(await readFile(path, "utf8"), /ORB::create\(5000\)/);
    assert.equal((await patchStitcherFile(root)).changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
