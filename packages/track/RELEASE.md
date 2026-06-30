# Release checklist

This document describes the manual release process for `stgy-track`.

The package is still in development, so adjust version numbers and publish steps
to match the actual repository policy.

## 1. Review working tree

```sh
git status
```

Confirm that only intended files are modified.

Expected project files include:

```text
README.md
TRACKJSON.md
TESTING.md
examples/
src/fit.ts
src/fit.test.ts
src/fit-demo.ts
src/fit-demo.html
src/loader.ts
src/loader.test.ts
src/trackjson.ts
src/trackjson.test.ts
```

## 2. Install dependencies

```sh
npm install
```

## 3. Run automated checks

```sh
npm run test
npm run check
npm run lint
npm run bundle
```

Do not continue if any command fails.

## 4. Check generated bundles

Confirm the expected browser bundles exist.

```sh
ls -l dist/track-viewer.js
ls -l dist/fit-demo.js
```

If the build emits CSS bundles, also confirm the CSS files exist.

```sh
ls -l dist/track-viewer.css
```

## 5. Run examples through HTTP

Do not open examples with `file://`.

Start an HTTP server from the package root.

```sh
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/examples/index.html
```

Check:

```text
simple-track.html
compressed-track.html
multi-track.html
pin.html
graph.html
```

Expected:

```text
No 404 for dist/track-viewer.js
No 404 for dist/track-viewer.css if the CSS bundle is used
No "StgyTrackViewer is not defined"
No "Track data MIME type is not supported"
Map renders
Routes render
Graph renders
HUD works
```

## 6. Run FIT demo manually

Open:

```text
http://localhost:8000/src/fit-demo.html
```

or the actual demo path used by the project.

Check uploads:

```text
.fit
.trj
.json
.geojson
.trjgz
```

For each file type, confirm:

```text
Route renders
Summary appears
Downsampling can be disabled
Uniform downsampling works
Aggregate downsampling works
Download TrackJSON produces .trj
Compressed download produces .trjgz
Numeric compaction is applied
```

## 7. Browser cache check

If behavior looks stale:

```text
Hard reload
Disable cache in DevTools
Confirm dist/track-viewer.js timestamp changed
Confirm dist/fit-demo.js timestamp changed
```

## 8. Documentation check

Review these files before tagging.

```text
README.md
TRACKJSON.md
TESTING.md
examples/README.md
CHANGELOG.md
RELEASE.md
```

Confirm that:

```text
.trj is documented as the preferred raw TrackJSON extension
.trjgz is documented as gzip-compressed TrackJSON
HTTP server usage is documented for examples
Downsampling strategy behavior is documented
Numeric precision behavior is documented
Browser API limitations are documented
```

## 9. Package metadata check

Review `package.json`.

Check:

```text
name
version
description
license
main / module / types
files
scripts
dependencies
devDependencies
sideEffects
```

If CSS is imported by the bundle, avoid marking the package as fully side-effect
free unless CSS handling is already accounted for.

## 10. Version bump

Choose the next version according to the repository policy.

Examples:

```sh
npm version patch
npm version minor
```

Do not run this until the repository is ready for a commit/tag.

## 11. Final verification

After the version bump, run:

```sh
npm run test
npm run check
npm run lint
npm run bundle
```

## 12. Commit

Example:

```sh
git add README.md TRACKJSON.md TESTING.md CHANGELOG.md RELEASE.md examples src package.json
git commit -m "Add TrackJSON viewer, FIT conversion, and examples"
```

Adjust the file list and message to match the actual changes.

## 13. Tag or publish

If using npm publish:

```sh
npm publish
```

If using Git tags only:

```sh
git tag vX.Y.Z
git push origin main --tags
```

Use the actual branch and version policy of the project.

## 14. Post-release smoke test

Install or check out the released version in a clean directory.

Run:

```sh
npm install
npm run test
npm run bundle
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/examples/index.html
```

Confirm the released artifact works outside the development tree.
