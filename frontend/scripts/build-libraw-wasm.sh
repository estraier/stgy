#!/usr/bin/env bash
set -euo pipefail

LIBRAW_WASM_VERSION="1.6.0"
LIBRAW_WASM_COMMIT="32fd36a9883a10c1632bc20073f1ea88cc60487a"
EMSCRIPTEN_VERSION="5.0.7"
OUTPUT_DIR="${1:?usage: build-libraw-wasm.sh OUTPUT_DIR}"
WORK_DIR="${OUTPUT_DIR}.work"

for cmd in git python3 emcc emconfigure emmake autoreconf; do
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
  echo "Emscripten $EMSCRIPTEN_VERSION is required for the STGY LibRaw build." >&2
  emcc --version | head -n 1 >&2 || true
  exit 1
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

# Start from upstream v1.6.0, but remove OpenMP/pthread so the browser build does
# not require SharedArrayBuffer or cross-origin isolation. Keep the v1.6.0
# wrapper/worker and its JPEG/LCMS-enabled LibRaw 0.22.1 build unchanged.
python3 - <<'PY'
from pathlib import Path

path = Path("compileLibraw.sh")
text = path.read_text()
replacements = [
    ("  --enable-openmp \\\n", "  --disable-openmp \\\n"),
    ('  LDFLAGS="-s USE_PTHREADS=1 -sUSE_LIBJPEG=1 -lpthread -L../libs/ -llcms2"',
     '  LDFLAGS="-sUSE_LIBJPEG=1 -L../libs/ -llcms2"'),
    ("  -s USE_PTHREADS=1 \\\n", ""),
    ("  -O3 -flto -pthread \\\n", "  -O3 -flto \\\n"),
    ("node build.js\n", "rm -rf dist\nmkdir -p dist\ncp index.js worker.js libraw.js libraw.wasm index.d.ts dist/\n"),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence of {old!r}, found {count}")
    text = text.replace(old, new)
path.write_text(text)
PY

if grep -Eq 'USE_PTHREADS|--enable-openmp|(^|[[:space:]])-pthread([[:space:]]|$)' compileLibraw.sh; then
  echo "pthread/OpenMP flags remain in patched LibRaw-Wasm build script" >&2
  exit 1
fi

FORCE_LIBS=1 bash ./compileLibraw.sh

for file in index.js worker.js libraw.js libraw.wasm index.d.ts; do
  test -s "dist/$file" || {
    echo "missing LibRaw build artifact: dist/$file" >&2
    exit 1
  }
done

# A non-threaded Emscripten build must not contain the pthread runtime hooks that
# caused the previous Next/browser integration problem.
if grep -Eq 'shared[[:space:]]*:[[:space:]]*true|ENVIRONMENT_IS_PTHREAD|PThread\.init' dist/libraw.js; then
  echo "threaded runtime markers found in the supposedly non-pthread LibRaw build" >&2
  exit 1
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
  "pthread": false,
  "openmp": false
}
EOF2
rm -rf "$WORK_DIR"
