import assert from "node:assert/strict";
import { test } from "node:test";
import { patchOpenCvCmakeMemory } from "./patch-opencv-cmake-memory.mjs";
import { patchWasmMemoryMaximum, patchOpenCvRuntimeMemoryMaximum } from "./patch-opencv-wasm-memory.mjs";

// WASM memory section: one exported memory, limits min=1 page, max=32768 pages.
const wasmWithMemory = (maximum) => Buffer.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  5, 6, 1, 1, 1, ...maximum,
]);

test("patches native CMake linker flags before recompilation", () => {
  const source = 'set(EMSCRIPTEN_LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS} -s WASM_MEM_MAX=1GB -s ALLOW_MEMORY_GROWTH=1")';
  const result = patchOpenCvCmakeMemory(source);
  assert.match(result, /MAXIMUM_MEMORY=4GB/);
  assert.equal(patchOpenCvCmakeMemory(result), result);
  assert.throws(() => patchOpenCvCmakeMemory('missing flags'), /Unexpected/);
});

test("retrofits 1GiB/2GiB WASM ceiling to 4GiB, idempotently", () => {
  for (const [low, mid, high] of [[0x80, 0x80, 0x01], [0x80, 0x80, 0x02], [0x80, 0x80, 0x04]]) {
    const bytes = wasmWithMemory([low, mid, high]);
    const result = patchWasmMemoryMaximum(bytes);
    assert.equal(result.at(-1), 0x04);
    assert.equal(patchWasmMemoryMaximum(result), result);
  }
});

test("handles 1GiB/2GiB/4GiB Emscripten heap caps", () => {
  for (const maximum of [1073741824, 2147483648, 4294967296]) {
    const result = patchOpenCvRuntimeMemoryMaximum(`var getHeapMax=()=>${maximum};`);
    assert.equal(result, 'var getHeapMax=()=>4294967296;');
  }
  assert.throws(() => patchOpenCvRuntimeMemoryMaximum('var getHeapMax=()=>999;'), /Unexpected/);
});
