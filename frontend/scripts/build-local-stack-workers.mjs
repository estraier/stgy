import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const sourceDir = join(frontendDir, "src", "app", "local-stack-studio", "workers");
const destinationDir = join(frontendDir, "public", "generated", "local-stack-studio");

await rm(destinationDir, { recursive: true, force: true });
await mkdir(destinationDir, { recursive: true });

for (const name of ["orb.worker", "hdr.worker", "focus.worker"]) {
  await build({
    entryPoints: [join(sourceDir, `${name}.ts`)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    outfile: join(destinationDir, `${name}.js`),
    logLevel: "info",
  });
}
