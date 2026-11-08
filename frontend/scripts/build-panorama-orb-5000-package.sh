#!/usr/bin/env bash
# Compatibility with the earlier experimental build kit. The new canonical
# path vendors the single native WASM for the unified STGY OpenCV runtime.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
echo "This command now builds and vendors STGY's unified Panorama ORB=5000 WASM." >&2
exec bash "$SCRIPT_DIR/build-panorama-orb-5000-wasm.sh" "$@"
