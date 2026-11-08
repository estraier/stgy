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

## Fixed FoV and ABI

FoV `Estimate` preserves the existing OpenCV estimator and `BundleAdjusterRay`.
`EXIF` and manual diagonal-angle selections use a native extension to set
intrinsics **before** estimating camera rotations, and run
`BundleAdjusterReproj` with frozen focal length/principal point/aspect.
Because the new `setStgyFocalLengths()` method is **not** in the stock npm
package, the custom **generated JavaScript library and WASM must be deployed
as a matched pair**; changing the WASM alone is no longer sufficient.
The ordinary LSS modes remain on the same unified OpenCV runtime.

EXIF is used when each input has a valid 35mm-equivalent focal length, or
physical focal length plus sensor diagonal. All-or-nothing fallback uses
`Estimate` if any image lacks this metadata. The FoV is diagonal and
orientation-independent. It assumes the optical information describes the
actual processed frame; substantial crops or geometric lens corrections may
change effective FoV, in which case manual FoV or Estimate may be preferable.

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
changes the native Stitcher ORB initialization, PANORAMA matcher upper confidence cutoff,
and fixed-FoV API, then builds via upstream Docker,
then installs:

```text
frontend/vendor/opencv-orb5000/opencv_js.wasm
frontend/vendor/opencv-orb5000/manifest.json
frontend/vendor/opencv-orb5000/lib/  # generated JavaScript ESM bindings
```

**Commit/distribute all three outputs** alongside the STGY sources. The binary may be
large; source-only distributions that omit it cannot make a reproducible STGY
production build until a maintainer rebuilds it. Do not commit upstream source
checkouts, downloaded archives, compiler caches, or `frontend/public/vendor/`.

There is no need for regular users or STGY deployments to have Docker, Python,
or a separate OpenCV installation. Running `npm ci` still installs the pinned `@banou/opencv-wasm@0.0.6`
package as the baseline. `build:opencv-assets` verifies the manifest and
SHA-256 of **both** custom WASM and generated ESM, then overlays the matched
assets into `frontend/public/vendor/opencv/lib/`. If these are absent or
mismatched it fails rather than silently reverting to the stock runtime.

## Checks

```sh
node --test frontend/scripts/patch-opencv-panorama-orb.test.mjs frontend/scripts/opencv-orb5000-asset.test.mjs frontend/scripts/build-opencv-assets.test.mjs
npm run check:opencv --workspace frontend
npm run build:opencv-assets --workspace frontend
npm run frontend:build
```

The manifest uses schemaVersion 4 and requires the upper confidence limit
and fixed FoV binding identifiers plus WASM/ESM hashes. The old ORB=5000
binary cannot masquerade as the new build; a fresh native compile is required.

`check:opencv` runs existing native ECC/ORB/CLAHE/pyramids/Stitcher checks
using the **vendored** WASM bytes, not the original npm WASM. The manifest records the builder's git commit, modified Stitcher source and
header SHA-256, WASM SHA-256 and generated ESM SHA-256. This confirms provenance and guards against accidental fallback, but
cannot independently introspect the private Stitcher feature-finder parameter
at runtime. A browser Panorama regression test with real inputs is still
recommended. The ORB setting is a maximum, not a guarantee that each input
contains 5000 detectable features.

## Upgrading the OpenCV npm package

Do not update only one side of the JS/WASM pair. Before changing
`@banou/opencv-wasm` or the OpenCV version, rebuild the native WASM against
the same binding generator version and re-run all checks.

## Fixed panorama FoV (schema version 4)

The custom OpenCV 5.0.0 `Stitcher` now exports `setStgyFocalLengths()`
through its generated ESM and native WASM. These are a **matched pair**.
`Estimate` intentionally does not call this setter and still uses stock
HomographyBasedEstimator + BundleAdjusterRay. `EXIF` and explicit diagonal
angles pass one focal length per source image (original proxy pixels); the
fixed branch uses HomographyBasedEstimator(true) and BundleAdjusterReproj with
an all-zero intrinsics refinement mask so only camera rotations are fitted.

After modifying the OpenCV C++ files, always run the existing one-time build
command and commit **all** of the following together:

- `frontend/vendor/opencv-orb5000/opencv_js.wasm`
- `frontend/vendor/opencv-orb5000/manifest.json` (schemaVersion=4)
- `frontend/vendor/opencv-orb5000/lib/` (generated ESM binding library)

The normal STGY `npm ci`, `check:opencv` and build consume these locally
vendored assets; Docker/Python are not needed for deployments. The asset
validation fails closed until the matched native and ESM rebuild is installed.

## Panorama projection (Auto / Horizontal / Vertical / Spherical)

Auto classifies the **pre-wave-corrected** camera optical axes and chooses
horizontal cylindrical, vertical cylindrical, or the legacy spherical
projection for mixed/ambiguous trajectories. Spherical explicitly reproduces
the historical projection (automatic wave correction and no direction limits).
Horizontal / Vertical retain the per-neighbor 5% along-axis minimum and 25%
cross-axis maximum. All stages (seams, exposure, ROI and high-precision compose)
use the same projection. Vertical applies a global camera-to-world 90-degree
roll before cylindrical mapping and restores the final output orientation.
The full-resolution input files are never rotated/copied.

The fixed-FoV C++ estimator now initializes ppx/ppy to the proxy image center
before HomographyBasedEstimator(true); schemaVersion 4 intentionally rejects
older binaries. Run `bash frontend/scripts/build-panorama-orb-5000-wasm.sh
../opencv-wasm`, then include the resulting WASM, ESM, and manifest in source
archives. Ordinary frontend builds should not silently revert to older WASM.
