import assert from 'node:assert/strict';
import test from 'node:test';
import { patchGlogThreads } from './patch-opencv-glog-threads.mjs';

const source = `cmake_minimum_required (VERSION 3.16)
project (glog
VERSION 0.6.0
LANGUAGES CXX
)
option (WITH_THREADS "Enable multithreading support" ON)
if (NOT WITH_THREADS)
set (CMAKE_DISABLE_FIND_PACKAGE_Threads ON)
endif ()
find_package (Threads)
cmake_push_check_state (RESET)
set (CMAKE_REQUIRED_LIBRARIES Threads::Threads)
check_cxx_source_compiles ("
#define _XOPEN_SOURCE 500
#include <pthread.h>
int main(void) { return 0; }
" HAVE_RWLOCK)
cmake_pop_check_state ()
`;

test('glog 0.6.0 no-thread RWLOCK probe is guarded, not deleted', () => {
  const result = patchGlogThreads(source);
  assert.equal(result.changed, true);
  assert.match(result.text, /if \(WITH_THREADS AND TARGET Threads::Threads\)\ncmake_push_check_state \(RESET\)/);
  assert.match(result.text, /" HAVE_RWLOCK\)\ncmake_pop_check_state \(\)\nelse \(\)\nset \(HAVE_RWLOCK 0\)\nendif \(\)/);
});

test('patch is idempotent', () => {
  const once = patchGlogThreads(source);
  const twice = patchGlogThreads(once.text);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('unexpected source versions fail closed', () => {
  assert.throws(() => patchGlogThreads(source.replace('VERSION 0.6.0','VERSION 0.8.0')), /Expected pinned/);
});

test('unrecognized probe fails closed', () => {
  assert.throws(() => patchGlogThreads(source.replace('Threads::Threads','Other::Lib')), /exactly one/);
});

test('partial patch fails closed', () => {
  assert.throws(() => patchGlogThreads(source + '\nif (WITH_THREADS AND TARGET Threads::Threads)\n'), /Partial or unexpected/);
});
