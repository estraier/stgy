# STGY fit-demo Leaflet CSS explicit fix v28

Fixes scrambled Leaflet tiles in fit-demo.html without putting CSS imports back
into the package JS entry.

Why:
- Next.js needs `stgy-track` JS entries to be CSS-free.
- Static demos still need Leaflet's CSS.
- fit-demo.html now explicitly loads `./dist/leaflet.css` before
  `./dist/track-viewer.css`.

Files:
- packages/track/fit-demo.html
- packages/track/package.json
- packages/track/scripts/copy-assets.js
- packages/track/src/fit-demo.ts

Apply:
```sh
cd ~/dev/stgy
cp ~/Downloads/stgy_track_fit_demo_leaflet_css_explicit_v28/packages/track/fit-demo.html packages/track/fit-demo.html
cp ~/Downloads/stgy_track_fit_demo_leaflet_css_explicit_v28/packages/track/package.json packages/track/package.json
mkdir -p packages/track/scripts
cp ~/Downloads/stgy_track_fit_demo_leaflet_css_explicit_v28/packages/track/scripts/copy-assets.js packages/track/scripts/copy-assets.js
cp ~/Downloads/stgy_track_fit_demo_leaflet_css_explicit_v28/packages/track/src/fit-demo.ts packages/track/src/fit-demo.ts

cd packages/track
rm -rf dist
npm run dist
python3 -m http.server 8000
```

Then open the demo in a new tab or hard-reload:
`http://localhost:8000/fit-demo.html`
