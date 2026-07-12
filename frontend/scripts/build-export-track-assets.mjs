import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const repositoryDir = path.resolve(frontendDir, "..");
const outputDir = path.join(frontendDir, "public", "export-assets");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(repositoryDir, "packages", "track", "src", "browser.ts")],
  outfile: path.join(outputDir, "track-viewer.js"),
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "StgyTrackViewer",
  target: ["es2020"],
  legalComments: "none",
  loader: {
    ".png": "dataurl",
    ".svg": "dataurl",
  },
});
