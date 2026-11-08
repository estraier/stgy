#!/usr/bin/env bash
# One-time native build. Ordinary STGY npm ci/build uses the vendored result.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STGY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="${1:-}"
if [[ -z "$SRC_DIR" || ! -f "$SRC_DIR/package.json" || ! -f "$SRC_DIR/scripts/build-wasm.sh" ]]; then
  echo "Usage (from STGY root): bash frontend/scripts/build-panorama-orb-5000-wasm.sh ../opencv-wasm" >&2
  exit 2
fi
SRC_DIR="$(cd -- "$SRC_DIR" && pwd)"
for command in node npm docker curl tar sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing build prerequisite: $command (Node 22+, Python 3.12+, Docker, curl, tar, sha256sum)." >&2
    exit 1
  fi
done
# Upstream invokes python3 and uses the tarfile data filter (Python 3.12+).
python_is_compatible() {
  "$1" -c 'import sys, tarfile; assert sys.version_info >= (3, 12) and hasattr(tarfile, "data_filter")' >/dev/null 2>&1
}
python_candidates=()
if [[ -n "${PYTHON_BIN:-}" ]]; then
  python_candidates+=("$PYTHON_BIN")
else
  python_candidates+=(python3 python3.12 python3.13 python3.14 python3.15)
  if command -v brew >/dev/null 2>&1; then
    for version in 3.12 3.13 3.14 3.15; do
      brew_prefix="$(brew --prefix "python@$version" 2>/dev/null || true)"
      if [[ -n "$brew_prefix" ]]; then python_candidates+=("$brew_prefix/bin/python$version"); fi
    done
  fi
fi
selected_python=""
for candidate in "${python_candidates[@]}"; do
  if command -v "$candidate" >/dev/null 2>&1 && python_is_compatible "$candidate"; then
    selected_python="$(command -v "$candidate")"; break
  fi
done
if [[ -z "$selected_python" ]]; then
  echo "Python 3.12+ with tarfile.data_filter is required. On macOS: brew install python@3.12" >&2
  exit 1
fi
python_shim_dir="$(mktemp -d "${TMPDIR:-/tmp}/stgy-orb-python.XXXXXXXX")"
trap 'rm -rf -- "$python_shim_dir"' EXIT
ln -s "$selected_python" "$python_shim_dir/python3"
export PATH="$python_shim_dir:$PATH"
echo "Building with $(python3 --version) ($selected_python)"
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable. Start Docker before building OpenCV." >&2
  exit 1
fi
# A single DNN C++ compilation may consume considerable memory. Parallel
# compilation can trigger SIGKILL / exit 137 within Docker Desktop's VM,
# especially when emulating linux/amd64 on Apple Silicon. This one-time
# maintainer build favors a safe memory footprint over compilation speed.
BUILD_JOBS="${BUILD_JOBS:-1}"
if [[ ! "$BUILD_JOBS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid BUILD_JOBS='$BUILD_JOBS': expected a positive integer." >&2
  exit 2
fi
export BUILD_JOBS
printf 'OpenCV native compilation jobs: %s (override with BUILD_JOBS=N)\n' "$BUILD_JOBS"
docker_memory_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
if [[ "$docker_memory_bytes" =~ ^[0-9]+$ ]]; then
  docker_memory_tenths=$(( docker_memory_bytes * 10 / 1073741824 ))
  printf 'Docker-reported memory: %s.%s GiB\n' "$((docker_memory_tenths / 10))" "$((docker_memory_tenths % 10))"
fi
if [[ "$(node -p 'require(process.argv[1]).version' "$SRC_DIR/package.json")" != "0.0.6" ]]; then
  echo "Expected @banou/opencv-wasm 0.0.6 source checkout." >&2
  exit 1
fi
cd "$SRC_DIR"
mkdir -p .cache vendor
for project in opencv opencv_contrib; do
  archive=".cache/$project-5.0.0.tar.gz"
  if [[ ! -f "$archive" ]]; then
    curl --fail --location --retry 3 "https://github.com/opencv/$project/archive/refs/tags/5.0.0.tar.gz" --output "$archive"
  fi
done
sha256sum --check scripts/sources.sha256
for project in opencv opencv_contrib; do
  if [[ ! -d "vendor/$project-5.0.0" ]]; then
    tar -xzf ".cache/$project-5.0.0.tar.gz" -C vendor
  fi
done
node "$STGY_ROOT/frontend/scripts/patch-opencv-panorama-orb.mjs" "$SRC_DIR/vendor/opencv-5.0.0"
npm ci
# The pinned glog 0.6.0 build disables threads but probes Threads::Threads
# unconditionally. Prepare once, then patch only that unsupported probe.
# Do not delete vendor/dependencies on every retry: the upstream builder caches
# successful dependency builds in build/dependencies/<name>/.installed.
python3 scripts/prepare-dependencies.py
node "$STGY_ROOT/frontend/scripts/patch-opencv-glog-threads.mjs" "$SRC_DIR/vendor/dependencies/glog-0.6.0"
npm run build
node "$STGY_ROOT/frontend/scripts/install-panorama-orb-5000-wasm.mjs" "$SRC_DIR"
cd "$STGY_ROOT"
# Test the ACTUAL vendored WASM, not the standard npm version.
npm run check:opencv --workspace frontend
npm run build:opencv-assets --workspace frontend
printf '\nSTGY Panorama ORB=5000 WASM installed and verified.\n'
printf 'Track frontend/vendor/opencv-orb5000/opencv_js.wasm and manifest.json for source distributions.\n'
