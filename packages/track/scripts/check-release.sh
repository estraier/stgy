#!/bin/sh
set -eu

echo "== stgy-track release check =="

if [ ! -f package.json ]; then
  echo "error: run this script from the package root." >&2
  exit 1
fi

echo
echo "== npm tests =="
npm run test

echo
echo "== TypeScript check =="
npm run check

echo
echo "== ESLint =="
npm run lint

echo
echo "== Build distribution =="
npm run dist

echo
echo "== Required dist and package files =="
required_files="
dist/index.js
dist/index.d.ts
dist/fit.js
dist/fit.d.ts
dist/trackjson.js
dist/trackjson.d.ts
dist/track-viewer.js
dist/fit-demo.js
README.md
TRACKJSON.md
CHANGELOG.md
LICENSE
trackjson.schema.json
"

missing=0
for file in $required_files; do
  if [ ! -f "$file" ]; then
    echo "missing: $file" >&2
    missing=1
  else
    echo "ok: $file"
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "error: required files are missing." >&2
  exit 1
fi

if [ ! -f dist/track-viewer.css ]; then
  echo "warning: dist/track-viewer.css was not found." >&2
  echo "warning: if package.json exports ./track-viewer.css, confirm CSS bundling." >&2
else
  echo "ok: dist/track-viewer.css"
fi

echo
echo "== Unexpected test files in dist =="
unexpected_test_files=$(
  find dist -type f \( \
    -name "*.test.js" -o \
    -name "*.test.d.ts" -o \
    -name "*.spec.js" -o \
    -name "*.spec.d.ts" \
  \) -print
)

if [ -n "$unexpected_test_files" ]; then
  echo "$unexpected_test_files" >&2
  echo "error: test build artifacts must not be included in dist." >&2
  exit 1
fi

echo "ok: no test build artifacts"

echo
echo "== npm package dry run =="
npm run pack:dry-run

echo
echo "== Git status =="
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git status --short
else
  echo "git repository not detected; skipping git status."
fi

echo
echo "== Done =="
echo "Automated release checks passed."
echo "Next: run examples and FIT demo manually through HTTP."
