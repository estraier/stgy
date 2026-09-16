#!/usr/bin/env bash
set -euo pipefail

LIBRAW_WASM_VERSION="1.6.0"
LIBRAW_WASM_COMMIT="32fd36a9883a10c1632bc20073f1ea88cc60487a"
SINGLE_EMSCRIPTEN_VERSION="5.0.7"
# Emscripten first gained an in-tree wasm OpenMP/libomp runtime after 5.0.7.
# Keep the proven single-thread build pinned to 5.0.7, but use the first
# released toolchain in this project line that contains that OpenMP runtime for
# the isolated Studio build.
THREADED_EMSCRIPTEN_VERSION="6.0.3"
OPENMP_THREADS=4
STGY_LIBRAW_THREADED_BUILD_REVISION=3
OUTPUT_DIR="${1:?usage: build-libraw-wasm.sh OUTPUT_DIR MODE}"
MODE="${2:?usage: build-libraw-wasm.sh OUTPUT_DIR MODE}"
WORK_DIR="${OUTPUT_DIR}.work"

case "$MODE" in
  single) EMSCRIPTEN_VERSION="$SINGLE_EMSCRIPTEN_VERSION" ;;
  threaded) EMSCRIPTEN_VERSION="$THREADED_EMSCRIPTEN_VERSION" ;;
  *)
    echo "unknown LibRaw build mode: $MODE (expected single or threaded)" >&2
    exit 1
    ;;
esac

for cmd in git python3 emcc em++ emconfigure emmake autoreconf; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "missing required command: $cmd" >&2
    exit 1
  }
done
if ! command -v libtoolize >/dev/null 2>&1 && ! command -v glibtoolize >/dev/null 2>&1; then
  echo "missing required command: libtoolize or glibtoolize" >&2
  exit 1
fi

if ! emcc --version | head -n 1 | grep -Fq "$EMSCRIPTEN_VERSION"; then
  echo "Emscripten $EMSCRIPTEN_VERSION is required for the STGY LibRaw $MODE build." >&2
  emcc --version | head -n 1 >&2 || true
  exit 1
fi

# Emscripten 5.0.7 predates the wasm libomp runtime.  The old upstream
# LibRaw-Wasm script could therefore accept --enable-openmp, fail the configure
# probe, and silently compile serial code.  For the threaded Studio build,
# verify up front that this toolchain can compile *and link* a real OpenMP
# program before touching LibRaw.  This produces a useful error instead of a
# seemingly unrelated failure in a LibRaw decoder translation unit.
if [ "$MODE" = "threaded" ]; then
  probe_dir="$(mktemp -d)"
  trap 'rm -rf "$probe_dir"' EXIT
  cat > "$probe_dir/openmp_probe.cpp" <<'CPP'
#include <omp.h>
int main() {
  omp_set_dynamic(0);
  omp_set_num_threads(4);
  int n = 1;
#pragma omp parallel
  {
#pragma omp single
    n = omp_get_num_threads();
  }
  return n == 4 ? 0 : 1;
}
CPP
  if ! em++ -O1 -fopenmp -pthread "$probe_dir/openmp_probe.cpp" -o "$probe_dir/openmp_probe.js"; then
    echo "Emscripten $EMSCRIPTEN_VERSION cannot compile/link the OpenMP probe required by threaded LibRaw." >&2
    echo "Use Emscripten $THREADED_EMSCRIPTEN_VERSION or newer with the wasm libomp runtime." >&2
    exit 1
  fi
  rm -rf "$probe_dir"
  trap - EXIT
fi

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

git clone --branch "v${LIBRAW_WASM_VERSION}" --depth 1 \
  https://github.com/ybouane/LibRaw-Wasm.git "$WORK_DIR/source"

cd "$WORK_DIR/source"
actual_commit="$(git rev-parse HEAD)"
if [ "$actual_commit" != "$LIBRAW_WASM_COMMIT" ]; then
  echo "unexpected LibRaw-Wasm commit: $actual_commit" >&2
  echo "expected: $LIBRAW_WASM_COMMIT" >&2
  exit 1
fi

# Upstream v1.6.0 already enables LibRaw OpenMP and Emscripten pthreads. Keep
# those flags intact for the isolated Local Image/Stack Studio build. For the
# normal STGY build, remove only the OpenMP/pthread flags so it can run without
# SharedArrayBuffer or cross-origin isolation.
python3 - "$MODE" <<'PY'
from pathlib import Path
import re
import sys

mode = sys.argv[1]
path = Path("compileLibraw.sh")
text = path.read_text()

if mode == "single":
    replacements = [
        ("  --enable-openmp \\\n", "  --disable-openmp \\\n"),
        ('  LDFLAGS="-s USE_PTHREADS=1 -sUSE_LIBJPEG=1 -lpthread -L../libs/ -llcms2"',
         '  LDFLAGS="-sUSE_LIBJPEG=1 -L../libs/ -llcms2"'),
        ("  -s USE_PTHREADS=1 \\\n", ""),
        ("  -O3 -flto -pthread \\\n", "  -O3 -flto \\\n"),
    ]
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"expected exactly one occurrence of {old!r}, found {count}")
        text = text.replace(old, new)
else:
    # Do not rely on LibRaw's configure probe alone. The static LibRaw archive
    # must be compiled with OpenMP code generation enabled, and every C/C++
    # compilation unit that can participate in pthreads must see -pthread.
    # Without -fopenmp, _OPENMP is absent, LibRaw's LIBRAW_USE_OPENMP guards
    # compile the parallel regions out, and the final WASM is threaded-capable
    # but the RAW processing itself remains effectively serial.
    for flag_name in ("CFLAGS", "CXXFLAGS"):
        pattern = re.compile(rf'({flag_name}=")([^"]+)(")')
        matches = list(pattern.finditer(text))
        if len(matches) != 1:
            raise SystemExit(f"expected exactly one {flag_name} assignment, found {len(matches)}")
        def add_openmp(match):
            flags = match.group(2)
            if "-fopenmp" not in flags:
                flags += " -fopenmp -pthread"
            return match.group(1) + flags + match.group(3)
        text = pattern.sub(add_openmp, text, count=1)

    # Link the LibRaw configure/build probes with the OpenMP runtime too.
    old_ldflags = 'LDFLAGS="-s USE_PTHREADS=1 -sUSE_LIBJPEG=1 -lpthread -L../libs/ -llcms2"'
    new_ldflags = 'LDFLAGS="-s USE_PTHREADS=1 -sUSE_LIBJPEG=1 -lpthread -pthread -fopenmp -L../libs/ -llcms2"'
    count = text.count(old_ldflags)
    if count != 1:
        raise SystemExit(f"expected exactly one threaded LDFLAGS assignment, found {count}")
    text = text.replace(old_ldflags, new_ldflags)

    # Stage B compiles libraw_wrapper.cpp. It must also use -fopenmp; otherwise
    # the wrapper's _OPENMP/LIBRAW_USE_OPENMP guards disappear and
    # omp_set_num_threads() is never executed.
    old_stage_b = "  -O3 -flto -pthread \\\n"
    new_stage_b = "  -O3 -flto -fopenmp -pthread \\\n"
    count = text.count(old_stage_b)
    if count != 1:
        raise SystemExit(f"expected exactly one Stage B pthread compile line, found {count}")
    text = text.replace(old_stage_b, new_stage_b)

    # Fail the build instead of silently publishing a threaded runtime whose
    # LibRaw wrapper was compiled without OpenMP. libraw/libraw.h has already
    # translated _OPENMP into LIBRAW_USE_OPENMP for supported platforms.
    wrapper_path = Path("libraw_wrapper.cpp")
    wrapper = wrapper_path.read_text()
    class_marker = "class WASMLibRaw {"
    if wrapper.count(class_marker) != 1:
        raise SystemExit("expected exactly one WASMLibRaw class declaration")
    wrapper = wrapper.replace(
        class_marker,
        '#ifndef _OPENMP\n'
        '#error "STGY threaded LibRaw wrapper must be compiled with -fopenmp"\n'
        '#endif\n'
        '#ifndef LIBRAW_USE_OPENMP\n'
        '#error "STGY threaded LibRaw build did not enable LibRaw OpenMP regions"\n'
        '#endif\n\n'
        + class_marker,
        1,
    )
    wrapper_path.write_text(wrapper)

    # LibRaw's OpenMP regions synchronously create/join pthreads. Prewarm a
    # pool so the WebAssembly code never has to wait for newly-created browser
    # workers to become runnable while it is already inside a blocking OpenMP
    # region. STGY deliberately fixes the OpenMP team at four threads, so a
    # four-worker pool is sufficient and avoids spawning hardwareConcurrency
    # workers on large machines.
    old = "  -s USE_PTHREADS=1 \\\n"
    new = (
        "  -s USE_PTHREADS=1 \\\n"
        "  -s PTHREAD_POOL_SIZE=4 \\\n"
        "  -s PTHREAD_POOL_SIZE_STRICT=2 \\\n"
    )
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence of {old!r}, found {count}")
    text = text.replace(old, new)

    # Emscripten's pthread pool size only controls how many browser Workers are
    # pre-created; it does not set the OpenMP team size. Pin LibRaw itself to
    # four OpenMP threads so benchmark results are deterministic and so the
    # threaded Studio build actually uses the intended level of parallelism.
    wrapper_path = Path("libraw_wrapper.cpp")
    wrapper = wrapper_path.read_text()
    constructor_pattern = re.compile(
        r"(?P<indent>^[ \t]*)WASMLibRaw\(\)\s*\{\s*"
        r"processor_\s*=\s*new\s+LibRaw\(\);\s*"
        r"(?P=indent)\}",
        re.MULTILINE,
    )
    matches = list(constructor_pattern.finditer(wrapper))
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one WASMLibRaw constructor, found {len(matches)}")
    indent = matches[0].group("indent")
    body_indent = indent + "    "
    new_constructor = (
        f"{indent}WASMLibRaw() {{\n"
        f"{body_indent}#ifdef LIBRAW_USE_OPENMP\n"
        f"{body_indent}omp_set_dynamic(0);\n"
        f"{body_indent}omp_set_num_threads(4);\n"
        f"{body_indent}int stgy_actual_openmp_threads = 1;\n"
        f"{body_indent}#pragma omp parallel\n"
        f"{body_indent}{{\n"
        f"{body_indent}    #pragma omp single\n"
        f"{body_indent}    stgy_actual_openmp_threads = omp_get_num_threads();\n"
        f"{body_indent}}}\n"
        f"{body_indent}std::cout << \"[LibRaw] OpenMP max threads=\" << omp_get_max_threads()\n"
        f"{body_indent}          << \", actual parallel threads=\" << stgy_actual_openmp_threads << std::endl;\n"
        f"{body_indent}#endif\n"
        f"{body_indent}processor_ = new LibRaw();\n"
        f"{indent}}}"
    )
    wrapper_path.write_text(constructor_pattern.sub(new_constructor, wrapper, count=1))

# We serve these files directly rather than bundling them with upstream's
# esbuild step. This keeps relative worker/WASM URLs intact and avoids needing
# Node/esbuild in the Emscripten builder image. Copy any pthread helper emitted
# by Emscripten as well as the stable LibRaw-Wasm wrapper files.
old = "node build.js\n"
new = '''rm -rf dist
mkdir -p dist
cp index.js worker.js libraw.js libraw.wasm index.d.ts dist/
for file in libraw*.worker.js libraw*.worker.mjs; do
  [ -f "$file" ] && cp "$file" dist/
done
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one occurrence of {old!r}, found {count}")
text = text.replace(old, new)
path.write_text(text)
PY

if [ "$MODE" = "single" ]; then
  if grep -Eq 'USE_PTHREADS|--enable-openmp|(^|[[:space:]])-pthread([[:space:]]|$)' compileLibraw.sh; then
    echo "pthread/OpenMP flags remain in patched single-thread LibRaw-Wasm build script" >&2
    exit 1
  fi
else
  if ! grep -Fq -- '--enable-openmp' compileLibraw.sh \
      || ! grep -Fq 'USE_PTHREADS=1' compileLibraw.sh \
      || ! grep -Fq 'PTHREAD_POOL_SIZE=4' compileLibraw.sh \
      || ! grep -Fq 'PTHREAD_POOL_SIZE_STRICT=2' compileLibraw.sh \
      || [ "$(grep -o -- '-fopenmp' compileLibraw.sh | wc -l | tr -d ' ')" -lt 4 ] \
      || ! grep -Fq 'STGY threaded LibRaw wrapper must be compiled with -fopenmp' libraw_wrapper.cpp \
      || ! grep -Fq 'omp_set_num_threads(4)' libraw_wrapper.cpp \
      || ! grep -Eq '(^|[[:space:]])-pthread([[:space:]]|$)' compileLibraw.sh; then
    echo "threaded LibRaw-Wasm build lost its OpenMP/pthread flags" >&2
    exit 1
  fi
fi

FORCE_LIBS=1 bash ./compileLibraw.sh

for file in index.js worker.js libraw.js libraw.wasm index.d.ts; do
  test -s "dist/$file" || {
    echo "missing LibRaw build artifact: dist/$file" >&2
    exit 1
  }
done

if [ "$MODE" = "single" ]; then
  # The normal STGY build must remain usable without SharedArrayBuffer.
  if grep -Eq 'shared[[:space:]]*:[[:space:]]*true|ENVIRONMENT_IS_PTHREAD|PThread\.init|SharedArrayBuffer' dist/libraw.js; then
    echo "threaded runtime markers found in the single-thread LibRaw build" >&2
    exit 1
  fi
  pthread=false
  openmp=false
else
  # The isolated Studio build must really contain the Emscripten pthread runtime.
  if ! grep -Eq 'ENVIRONMENT_IS_PTHREAD|PThread|SharedArrayBuffer' dist/libraw.js; then
    echo "pthread runtime markers were not found in the threaded LibRaw build" >&2
    exit 1
  fi
  pthread=true
  openmp=true
fi

cd /
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp -R "$WORK_DIR/source/dist" "$OUTPUT_DIR/dist"
cat > "$OUTPUT_DIR/build.json" <<EOF2
{
  "librawWasmVersion": "$LIBRAW_WASM_VERSION",
  "librawWasmCommit": "$LIBRAW_WASM_COMMIT",
  "librawVersion": "0.22.1",
  "emscriptenVersion": "$EMSCRIPTEN_VERSION",
  "stgyBuildRevision": $(if [ "$MODE" = "threaded" ]; then printf '%s' "$STGY_LIBRAW_THREADED_BUILD_REVISION"; else printf 'null'; fi),
  "mode": "$MODE",
  "pthread": $pthread,
  "openmp": $openmp,
  "pthreadPool": $(if [ "$MODE" = "threaded" ]; then printf '4'; else printf 'null'; fi),
  "openmpThreads": $(if [ "$MODE" = "threaded" ]; then printf '%s' "$OPENMP_THREADS"; else printf 'null'; fi)
}
EOF2
rm -rf "$WORK_DIR"
