# STGY track Next CSS entry fix v15

v14 removed CSS imports from renderer.ts, but index.ts can also import CSS.
Next.js was still loading leaflet/dist/leaflet.css from packages/track/dist/index.js.

Fix:
- packages/track/src/index.ts exports only JS symbols.
- packages/track/src/renderer.ts imports no CSS.
- frontend/src/app/layout.tsx imports Leaflet CSS and stgy-track/track-viewer.css.

Apply:
```sh
cd ~/dev/stgy
cp ~/Downloads/stgy_track_next_css_entry_fix_v15/packages/track/src/index.ts packages/track/src/index.ts
cp ~/Downloads/stgy_track_next_css_entry_fix_v15/packages/track/src/renderer.ts packages/track/src/renderer.ts
cp ~/Downloads/stgy_track_next_css_entry_fix_v15/packages/track/package.json packages/track/package.json
cp ~/Downloads/stgy_track_next_css_entry_fix_v15/frontend/src/app/layout.tsx frontend/src/app/layout.tsx
cp ~/Downloads/stgy_track_next_css_entry_fix_v15/frontend/src/app/track-sandbox/PageBody.tsx frontend/src/app/track-sandbox/PageBody.tsx

rm -rf packages/track/dist
npm run packages:build
grep -R "leaflet/dist/leaflet.css\|stgy-track.css" packages/track/dist || true

cd frontend
rm -rf .next
npm run build
npm run dev
```
