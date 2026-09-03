import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIBRAW_WASM_VERSION = "1.6.0";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const cacheDir = join(frontendDir, ".cache", `libraw-wasm-stgy-${LIBRAW_WASM_VERSION}`);
const sourceDir = join(cacheDir, "dist");
const destinationDir = join(frontendDir, "public", "vendor", "libraw-wasm");

execFileSync(process.execPath, [join(scriptDir, "build-libraw-wasm.mjs")], {
  cwd: frontendDir,
  stdio: "inherit",
});

await rm(destinationDir, { recursive: true, force: true });
await mkdir(dirname(destinationDir), { recursive: true });
await cp(sourceDir, destinationDir, { recursive: true });
