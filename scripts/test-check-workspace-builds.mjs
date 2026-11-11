import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const sourceScript = fileURLToPath(new URL("./check-workspace-builds.mjs", import.meta.url));

function addPackage(root, name) {
  const dir = path.join(root, "packages", name);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name, main: "dist/index.js", types: "dist/index.d.ts", scripts: { build: "tsc" },
  }));
  const input = path.join(dir, "src", "index.ts");
  const js = path.join(dir, "dist", "index.js");
  const types = path.join(dir, "dist", "index.d.ts");
  writeFileSync(input, "export const n = 1;\n");
  writeFileSync(js, "exports.n = 1;\n");
  writeFileSync(types, "export declare const n: number;\n");
  return { dir, input, js, types };
}

function withFixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "stgy-build-guard-"));
  try {
    const scripts = path.join(root, "scripts");
    mkdirSync(scripts, { recursive: true });
    copyFileSync(sourceScript, path.join(scripts, "check-workspace-builds.mjs"));
    const first = addPackage(root, "example");
    return run({ root, ...first });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invoke(root, command) {
  try {
    execFileSync(process.execPath, [path.join(root, "scripts", "check-workspace-builds.mjs"), ...command], {
      encoding: "utf8", stdio: "pipe",
    });
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, output: String(error.stderr) };
  }
}

const record = (root) => invoke(root, ["--record"]);
const verify = (root) => invoke(root, []);

test("requires a completed repository build even when dist files exist", () => withFixture(({ root }) => {
  const result = verify(root);
  assert.equal(result.ok, false);
  assert.match(result.output, /repository build record is missing/);
}));

test("accepts all shared packages after a complete build record", () => withFixture(({ root }) => {
  assert.equal(record(root).ok, true);
  assert.equal(verify(root).ok, true);
}));

test("rejects missing dist even with a matching build record", () => withFixture(({ root, js }) => {
  assert.equal(record(root).ok, true);
  rmSync(js);
  const result = verify(root);
  assert.equal(result.ok, false);
  assert.match(result.output, /missing output/);
  assert.match(result.output, /npm run build/);
}));

test("rejects changed sources even when ZIP timestamps are older than dist", () => withFixture(({ root, input, js }) => {
  assert.equal(record(root).ok, true);
  writeFileSync(input, "export const n = 2;\n");
  const old = new Date("2025-01-01T00:00:00Z");
  const future = new Date("2031-01-01T00:00:00Z");
  utimesSync(input, old, old);
  utimesSync(js, future, future);
  const result = verify(root);
  assert.equal(result.ok, false);
  assert.match(result.output, /source content has changed/);
}));

test("rejects changed sources in any one of multiple packages", () => withFixture(({ root }) => {
  const another = addPackage(root, "another");
  assert.equal(record(root).ok, true);
  writeFileSync(another.input, "export const n = 3;\n");
  const result = verify(root);
  assert.equal(result.ok, false);
  assert.match(result.output, /another: source content has changed/);
}));

test("does not record a successful build when a package dist is missing", () => withFixture(({ root, js }) => {
  rmSync(js);
  assert.equal(record(root).ok, false);
  const result = verify(root);
  assert.equal(result.ok, false);
  assert.match(result.output, /repository build record is missing/);
}));
