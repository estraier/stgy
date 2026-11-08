#!/usr/bin/env node
// glog 0.6.0 runs a Threads::Threads-backed RWLOCK probe even with
// WITH_THREADS=OFF, when CMake has not created that imported target.
// Keep the upstream no-threads build configuration and skip only that probe.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE = /(^cmake_push_check_state \(RESET\)\r?\nset \(CMAKE_REQUIRED_LIBRARIES Threads::Threads\)\r?\ncheck_cxx_source_compiles \("\r?\n[\s\S]*?\r?\n" HAVE_RWLOCK\)\r?\ncmake_pop_check_state \(\))/gm;
const MARKER = 'if (WITH_THREADS AND TARGET Threads::Threads)';

export function patchGlogThreads(source) {
  if (!/project\s*\(glog\b/.test(source) || !/VERSION 0\.6\.0\b/.test(source)) {
    throw new Error('Expected pinned glog 0.6.0 CMakeLists.txt');
  }
  if (source.includes(MARKER)) {
    // Do not accept arbitrary modifications merely because the marker exists.
    if (!source.includes('else ()\nset (HAVE_RWLOCK 0)\nendif ()')) {
      throw new Error('Partial or unexpected glog HAVE_RWLOCK patch');
    }
    return { text: source, changed: false };
  }
  const matches = [...source.matchAll(PROBE)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one glog HAVE_RWLOCK probe; found ${matches.length}`);
  }
  const original = matches[0][0];
  const replacement = `${MARKER}\n${original}\nelse ()\nset (HAVE_RWLOCK 0)\nendif ()`;
  return { text: source.replace(original, replacement), changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('Usage: node patch-opencv-glog-threads.mjs <vendor/dependencies/glog-0.6.0>');
    process.exit(2);
  }
  const filename = resolve(sourceDir, 'CMakeLists.txt');
  try {
    const source = await readFile(filename, 'utf8');
    const result = patchGlogThreads(source);
    if (result.changed) await writeFile(filename, result.text);
    console.log(`${result.changed ? 'Patched' : 'Already patched'}: ${filename} (glog 0.6.0 no-threads CMake probe)`);
  } catch (error) {
    console.error(`glog CMake compatibility fix failed: ${error.message}`);
    process.exitCode = 1;
  }
}
