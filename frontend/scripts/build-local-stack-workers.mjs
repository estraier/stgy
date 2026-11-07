import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const sourceDir = join(frontendDir, "src", "app", "local-stack-studio", "workers");
const destinationDir = join(frontendDir, "public", "generated", "local-stack-studio");

// Discover every worker entry point, including newly added ones. Missing an
// entry point must never silently remove a working generated Worker again.
const workerFiles = (await readdir(sourceDir))
  .filter((file) => file.endsWith(".worker.ts"))
  .sort();
if (workerFiles.length === 0) throw new Error("No Local Stack Studio Worker sources were found.");

// TypeScript deliberately ignores semantic errors in @ts-nocheck files.
// Do not allow that escape hatch in a worker; it hid an HDR1 ReferenceError.
for (const file of workerFiles) {
  const source = await readFile(join(sourceDir, file), "utf8");
  if (/^\s*\/\/\s*@ts-nocheck\b/m.test(source)) {
    throw new Error(`${file} disables TypeScript checking with @ts-nocheck.`);
  }
}

// The legacy controller still uses @ts-nocheck, so check its unresolved
// variables and imports independently before bundling.
const controllerCheck = spawnSync(process.execPath, [join(scriptDir, "check-local-stack-undefined.mjs")], {
  cwd: frontendDir,
  stdio: "inherit",
});
if (controllerCheck.error) throw controllerCheck.error;
if (controllerCheck.status !== 0) {
  throw new Error("Local Stack Studio controller name checking failed.");
}

// esbuild transpiles TypeScript without checking names or types. Run the real
// checker *before* touching published Worker assets, including direct builds.
const checked = spawnSync("tsc", ["--project", "tsconfig.lss-workers.json", "--pretty", "false"], {
  cwd: frontendDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (checked.error) throw checked.error;
if (checked.status !== 0) {
  throw new Error("Local Stack Studio Worker type checking failed.");
}

const stagingDir = `${destinationDir}.staging-${process.pid}`;
await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
try {
  for (const file of workerFiles) {
    const name = file.slice(0, -3);
    await build({
      entryPoints: [join(sourceDir, file)],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      outfile: join(stagingDir, `${name}.js`),
      logLevel: "info",
    });
  }
  // Keep the previous successfully built assets until every new entry point
  // has compiled. If replacement fails, restore the old directory.
  const backupDir = `${destinationDir}.backup-${process.pid}`;
  await rm(backupDir, { recursive: true, force: true });
  let hadPrevious = false;
  try {
    await rename(destinationDir, backupDir);
    hadPrevious = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await rename(stagingDir, destinationDir);
  } catch (error) {
    if (hadPrevious) await rename(backupDir, destinationDir);
    throw error;
  }
  if (hadPrevious) await rm(backupDir, { recursive: true, force: true });
} finally {
  await rm(stagingDir, { recursive: true, force: true });
}
