/**
 * Set the actual OpenCV 5.0.0 Emscripten link option to memory32's 4GiB ceiling.
 * This runs BEFORE native compilation so Emscripten emits unsigned JS pointer
 * operations for addresses beyond 2GiB. Post-link WASM/JS constant changes
 * alone do not establish complete >2GiB pointer safety.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function patchOpenCvCmakeMemory(content) {
  const oldFlag = "-s WASM_MEM_MAX=1GB";
  const newFlag = "-s MAXIMUM_MEMORY=4GB";
  const oldCount = content.split(oldFlag).length - 1;
  const newCount = content.split(newFlag).length - 1;
  if (oldCount === 1 && newCount === 0) return content.replace(oldFlag, newFlag);
  if (oldCount === 0 && newCount === 1) return content;
  throw new Error("Unexpected OpenCV 5.0.0 JS memory flags. Refusing to build an unverified configuration.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node frontend/scripts/patch-opencv-cmake-memory.mjs <opencv-5.0.0/modules/js/CMakeLists.txt>");
    process.exitCode = 2;
  } else {
    const path = resolve(process.argv[2]);
    const original = await readFile(path, "utf8");
    const revised = patchOpenCvCmakeMemory(original);
    if (revised !== original) await writeFile(path, revised, "utf8");
    console.log("OpenCV/Emscripten linker MAXIMUM_MEMORY=4GB is configured.");
  }
}
