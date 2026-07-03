const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const imagesDir = path.join(distDir, "images");
const leafletCssPath = require.resolve("leaflet/dist/leaflet.css");
const leafletImagesDir = path.join(path.dirname(leafletCssPath), "images");
const trackCssPath = path.join(root, "src", "stgy-track.css");

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

fs.copyFileSync(leafletCssPath, path.join(distDir, "leaflet.css"));
fs.copyFileSync(trackCssPath, path.join(distDir, "stgy-track.css"));
fs.copyFileSync(trackCssPath, path.join(distDir, "track-viewer.css"));

fs.readdirSync(leafletImagesDir).forEach((fileName) => {
  fs.copyFileSync(
    path.join(leafletImagesDir, fileName),
    path.join(imagesDir, fileName)
  );
});
