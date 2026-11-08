# STGY Panorama ORB=5000 — custom native WASM

## Scope

STGY uses one OpenCV runtime: `@banou/opencv-wasm@0.0.6` (OpenCV 5.0.0).
OpenCV's native `Stitcher::create(PANORAMA)` creates its feature finder as
`ORB::create()`, which defaults to 500 features per image. The distributed
JavaScript binding does **not** expose `Stitcher::setFeaturesFinder()`.

This change replaces the C++ constructor argument with `ORB::create(5000)`.
It also sets the PANORAMA-only `BestOf2NearestMatcher` upper confidence
cutoff to 3.5. OpenCV's default threshold of 3.0 discards geometrically
very strongly matched pairs by setting their confidence to zero; with 5000
ORB features, heavily overlapping images can exceed 3.0 even if they match
well. The confidence formula is inliers / (8 + 0.3 * matches), so 3.5 is
above its theoretical maximum (~3.333) and removes only this upper cutoff.
The ordinary *lower* panorama graph confidence, ORB descriptor ratio check,
RANSAC, homography estimation, bundle adjustment, wave correction, seam finding,
exposure correction and subsequent stitching algorithms are unchanged.
This is a plausible fix for a regression, not a verified reproduction until
real failing images are tested. STGY's ordinary ORB
alignment already uses 5000 features, independently of Panorama.

The resulting WASM has the **same JavaScript ABI** as the stock npm package.
STGY still uses the package's ESM `lib/` for JS declarations and helpers, but
its deployment script overrides `lib/opencv_js.wasm` with the compiled binary
from `frontend/vendor/opencv-orb5000/`. This avoids a local npm package,
changes to the lockfile, a second OpenCV runtime, or build-time Docker requirements
for ordinary STGY users and CI.

## One-time native build (maintainer only)

Requirements: Node 22+, npm, Python 3.12+, Docker, curl, tar, sha256sum.
Linux is the upstream-verified host. macOS requires the same prerequisites.

From the STGY root (where an adjacent `../opencv-wasm` checkout exists):

```sh
# Only needed if there is no adjacent source checkout:
git clone https://github.com/banou26/opencv-wasm.git ../opencv-wasm

# For macOS with an older system Python: brew install python@3.12
bash frontend/scripts/build-panorama-orb-5000-wasm.sh ../opencv-wasm
```

The maintainer build defaults to **one native compilation job** to prevent
memory exhaustion (`Killed`, `Error 137`) while compiling OpenCV DNN inside
Docker. Override it only when Docker has enough memory, e.g.
`BUILD_JOBS=2 bash frontend/scripts/build-panorama-orb-5000-wasm.sh ../opencv-wasm`.
The script reports Docker's configured memory. On macOS, adjust this in Docker
Desktop → Settings → Resources → Advanced → Memory if needed. A SIGKILL may
also have other causes, so this does not guarantee success. Re-running the
script retains previously built OpenCV object files and dependency caches;
do not delete `../opencv-wasm/build` or `../opencv-wasm/vendor` merely to retry.

The script ensures pinned SHA-256-checked OpenCV and contrib 5.0.0 sources,
changes only the native Stitcher ORB initialization and PANORAMA matcher upper confidence cutoff,
builds via upstream Docker,
then installs:

```text
frontend/vendor/opencv-orb5000/opencv_js.wasm
frontend/vendor/opencv-orb5000/manifest.json
```

**Commit/distribute both files** alongside the STGY sources. The binary may be
large; source-only distributions that omit it cannot make a reproducible STGY
production build until a maintainer rebuilds it. Do not commit upstream source
checkouts, downloaded archives, compiler caches, or `frontend/public/vendor/`.

There is no need for regular users or STGY deployments to have Docker, Python,
or a separate OpenCV installation. Running `npm ci` still installs the original
pinned `@banou/opencv-wasm@0.0.6` JavaScript wrapper and the standard binary;
`build:opencv-assets` then **must** verify and overlay the committed custom
WASM into `frontend/public/vendor/opencv/lib/`. It fails hard if the custom
WASM is missing, corrupt, or identical to the stock binary; silent rollback
is not permitted.

## Checks

```sh
node --test frontend/scripts/patch-opencv-panorama-orb.test.mjs frontend/scripts/opencv-orb5000-asset.test.mjs frontend/scripts/build-opencv-assets.test.mjs
npm run check:opencv --workspace frontend
npm run build:opencv-assets --workspace frontend
npm run frontend:build
```

The manifest now uses schemaVersion 2 and requires the upper confidence limit
field, so old ORB=5000 binaries cannot silently masquerade as the corrected
build. A fresh native compile is required.

`check:opencv` runs existing native ECC/ORB/CLAHE/pyramids/Stitcher checks
using the **vendored** WASM bytes, not the original npm WASM. The manifest
records the builder's git commit, modified Stitcher source SHA-256 and WASM
SHA-256. This confirms provenance and guards against accidental fallback, but
cannot independently introspect the private Stitcher feature-finder parameter
at runtime. A browser Panorama regression test with real inputs is still
recommended. The ORB setting is a maximum, not a guarantee that each input
contains 5000 detectable features.

## Upgrading the OpenCV npm package

Do not update only one side of the JS/WASM pair. Before changing
`@banou/opencv-wasm` or the OpenCV version, rebuild the native WASM against
the same binding generator version and re-run all checks.
