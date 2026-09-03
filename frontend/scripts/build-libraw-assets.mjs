import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const LIBRAW_VERSION = "1.1.2";
const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const entryPath = require.resolve("libraw-wasm");
const packageJsonPath = require.resolve("libraw-wasm/package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (packageJson.version !== LIBRAW_VERSION) {
  throw new Error(
    `libraw-wasm ${LIBRAW_VERSION} is required, but ${packageJson.version || "unknown"} is installed.`,
  );
}

const sourceDir = dirname(entryPath);
const destinationDir = join(frontendDir, "public", "vendor", "libraw-wasm");

await rm(destinationDir, { recursive: true, force: true });
await mkdir(dirname(destinationDir), { recursive: true });
await cp(sourceDir, destinationDir, { recursive: true });
