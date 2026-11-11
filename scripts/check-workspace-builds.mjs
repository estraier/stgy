/**
 * Enforce the repository-wide build contract without rebuilding subpackages.
 * `npm run build` at the STGY root records fingerprints after all workspaces
 * have built. Local frontend/backend start scripts only verify that record.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");
const recordFile = path.join(root, "node_modules", ".cache", "stgy-shared-build.json");
const isRecording = process.argv[2] === "--record";
const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json",
  ".svg", ".png", ".ndjson", ".csv", ".tsv", ".txt",
]);

async function getStat(filename) {
  try {
    return await stat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function updateDirectoryHash(hash, dir, baseDir) {
  if (!(await getStat(dir))) return;
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await updateDirectoryHash(hash, filename, baseDir);
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      const relative = path.relative(baseDir, filename).replaceAll(path.sep, "/");
      hash.update(relative).update("\0").update(await readFile(filename)).update("\0");
    }
  }
}

async function fingerprintPackage(packageDir) {
  const hash = createHash("sha256");
  const rootNames = (await readdir(packageDir)).filter((name) =>
    name === "package.json" || name === "trackjson.schema.json" || /^tsconfig.*\.json$/.test(name)
  ).sort();
  for (const name of rootNames) {
    hash.update(name).update("\0").update(await readFile(path.join(packageDir, name))).update("\0");
  }
  for (const subdirectory of ["src", "scripts", "data"]) {
    await updateDirectoryHash(hash, path.join(packageDir, subdirectory), packageDir);
  }
  return hash.digest("hex");
}

const errors = [];
const fingerprints = {};
const dirs = await readdir(packagesDir, { withFileTypes: true });
for (const entry of dirs.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
  if (!entry.isDirectory()) continue;
  const packageDir = path.join(packagesDir, entry.name);
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!(await getStat(packageJsonPath))) continue;
  const info = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (!info.scripts?.build) continue;

  const name = info.name ?? entry.name;
  const outputs = [info.main, info.types].filter(Boolean);
  if (outputs.length === 0) {
    errors.push(`${name}: no compiled entry points declared`);
    continue;
  }
  const outputStats = await Promise.all(outputs.map((output) => getStat(path.join(packageDir, output))));
  if (outputStats.some((item) => item === null)) {
    errors.push(`${name}: missing output (${outputs.join(", ")})`);
    continue;
  }
  fingerprints[name] = await fingerprintPackage(packageDir);
}

if (isRecording && errors.length === 0) {
  await mkdir(path.dirname(recordFile), { recursive: true });
  await writeFile(recordFile, JSON.stringify({ format: 1, fingerprints }, null, 2) + "\n");
} else if (!isRecording) {
  let record = null;
  try {
    record = JSON.parse(await readFile(recordFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") errors.push(`invalid build record: ${error.message}`);
  }
  if (!record || record.format !== 1) {
    errors.push("repository build record is missing or invalid");
  } else {
    for (const [name, fingerprint] of Object.entries(fingerprints)) {
      if (record.fingerprints?.[name] !== fingerprint) {
        errors.push(`${name}: source content has changed since the root build`);
      }
    }
    for (const name of Object.keys(record.fingerprints ?? {})) {
      if (!Object.hasOwn(fingerprints, name)) errors.push(`${name}: build output is no longer valid`);
    }
  }
}

if (errors.length > 0) {
  console.error("[STGY] Shared workspace build is missing or out of date:");
  for (const error of [...new Set(errors)]) console.error(`  - ${error}`);
  console.error("[STGY] Run `npm run build` from the STGY repository root, then restart frontend/backend.");
  process.exitCode = 1;
}
