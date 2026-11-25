/**
 * Verify or retrofit the vendored OpenCV 4GiB memory32 heap cap.
 * Native rebuilds must configure MAXIMUM_MEMORY=4GB BEFORE linking to
 * generate correct unsigned pointers above 2GiB. See patch-opencv-cmake-memory.mjs.
 * The default action can retrofit our previously verified vendored WASM;
 * native build automation must use --verify-only after the Emscripten build.
 *
 * Usage: node frontend/scripts/patch-opencv-wasm-memory.mjs <opencv-wasm/lib>
 * The script is idempotent and deliberately fails on unexpected upstream builds.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const WASM_PAGE_BYTES = 65536;
const OLD_MAX_PAGES = 16384;
const NEW_MAX_PAGES = 65536;
const MID_MAX_PAGES = 32768;
const OLD_MAX_BYTES = OLD_MAX_PAGES * WASM_PAGE_BYTES;
const NEW_MAX_BYTES = NEW_MAX_PAGES * WASM_PAGE_BYTES;
const MID_MAX_BYTES = MID_MAX_PAGES * WASM_PAGE_BYTES;

function readUleb128(bytes, offset) {
  const start = offset;
  let result = 0;
  let factor = 1;
  while (offset < bytes.length && offset - start < 5) {
    const value = bytes[offset++];
    result += (value & 127) * factor;
    if (!(value & 128)) return { value: result, start, end: offset };
    factor *= 128;
  }
  throw new Error("Invalid or unsupported WASM LEB128 integer.");
}

function encodeUleb128(value) {
  const bytes = [];
  let remaining = value;
  do {
    let digit = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) digit |= 128;
    bytes.push(digit);
  } while (remaining);
  return Buffer.from(bytes);
}

export function patchWasmMemoryMaximum(wasm) {
  if (!wasm.subarray(0, WASM_HEADER.length).equals(WASM_HEADER)) {
    throw new Error("Unexpected OpenCV WASM header.");
  }
  let offset = WASM_HEADER.length;
  let patched = false;
  while (offset < wasm.length) {
    const sectionId = wasm[offset++];
    const size = readUleb128(wasm, offset);
    offset = size.end;
    const sectionEnd = offset + size.value;
    if (sectionEnd > wasm.length) throw new Error("Invalid OpenCV WASM section length.");
    if (sectionId === 5) { // WebAssembly memory section
      const count = readUleb128(wasm, offset);
      if (count.value !== 1) throw new Error("Expected exactly one OpenCV WASM memory.");
      const flags = readUleb128(wasm, count.end);
      if (flags.value !== 1) throw new Error("Expected defined OpenCV WASM memory with a maximum.");
      const initial = readUleb128(wasm, flags.end);
      const maximum = readUleb128(wasm, initial.end);
      if (maximum.end !== sectionEnd) throw new Error("Unexpected OpenCV WASM memory section layout.");
      if (![OLD_MAX_PAGES, MID_MAX_PAGES, NEW_MAX_PAGES].includes(maximum.value)) {
        throw new Error(`Unexpected WASM max memory: ${maximum.value * WASM_PAGE_BYTES} bytes.`);
      }
      if (initial.value > NEW_MAX_PAGES) throw new Error("Initial memory exceeds the target maximum.");
      const replacement = encodeUleb128(NEW_MAX_PAGES);
      if (replacement.length !== maximum.end - maximum.start) {
        throw new Error("Changing the WASM memory limit would change section offsets.");
      }
      replacement.copy(wasm, maximum.start);
      patched = true;
    }
    offset = sectionEnd;
  }
  if (!patched) throw new Error("OpenCV WASM memory section was not found.");
  return wasm;
}

export function patchOpenCvRuntimeMemoryMaximum(glue) {
  const oldText = `getHeapMax=()=>${OLD_MAX_BYTES}`;
  const newText = `getHeapMax=()=>${NEW_MAX_BYTES}`;
  const middleText = `getHeapMax=()=>${MID_MAX_BYTES}`;
  const oldCount = glue.split(oldText).length - 1;
  const middleCount = glue.split(middleText).length - 1;
  const newCount = glue.split(newText).length - 1;
  if (oldCount + middleCount + newCount !== 1) {
    throw new Error("Unexpected Emscripten maximum-memory definition in opencv.mjs.");
  }
  if (oldCount === 1) return glue.replace(oldText, newText);
  if (middleCount === 1) return glue.replace(middleText, newText);
  if (newCount === 1) return glue;
  throw new Error("Unexpected Emscripten maximum-memory definition in opencv.mjs.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  if (process.argv.length < 3 || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== "--verify-only")) {
    console.error("Usage: node frontend/scripts/patch-opencv-wasm-memory.mjs <opencv-wasm/lib> [--verify-only]");
    process.exitCode = 2;
  } else {
    const directory = resolve(process.argv[2]);
    const wasmPath = join(directory, "opencv_js.wasm");
    const runtimePath = join(directory, "opencv.mjs");
    // Validate both representations before writing either one.
    const [originalWasm, originalRuntime] = await Promise.all([
      readFile(wasmPath), readFile(runtimePath, "utf8"),
    ]);
    const revisedWasm = patchWasmMemoryMaximum(Buffer.from(originalWasm));
    const revisedRuntime = patchOpenCvRuntimeMemoryMaximum(originalRuntime);
    if (process.argv[3] === "--verify-only") {
      if (!revisedWasm.equals(originalWasm) || revisedRuntime !== originalRuntime) {
        throw new Error("Native Emscripten build did not produce a 4GiB heap. Check MAXIMUM_MEMORY=4GB before linking.");
      }
    } else {
      await writeFile(wasmPath, revisedWasm);
      await writeFile(runtimePath, revisedRuntime, "utf8");
    }
    console.log(`OpenCV WASM heap ceiling: ${NEW_MAX_BYTES / 1048576}MiB`);
  }
}
