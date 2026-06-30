# stgy-track examples

These examples must be opened through HTTP.

Do not open them directly with `file://`, because route files such as `.trj` and
`.trjgz` are loaded with `fetch()`.

## Start the example server

Run from the package root, not from the `examples` directory.

```sh
cd ~/dev/stgy/packages/track
npm run bundle
npm run serve:examples
```

Then open:

```text
http://localhost:8000/examples/index.html
```

The package root must be the server root because the example HTML files load the
browser bundles from:

```text
../dist/track-viewer.css
../dist/track-viewer.js
```

If you start the server inside `examples/`, those files will return 404 and the
page will stay at `Map loading...`.

## Files

```text
index.html
simple-track.html
compressed-track.html
multi-track.html
pin.html
graph.html
base-layer.html
sample-track.trj
sample-track.trjgz
sample-track-alt.trj
```

## Checks

Use these examples for quick manual checks.

```text
simple-track.html      raw .trj loading
compressed-track.html  .trjgz loading
multi-track.html       multiple track sources
pin.html               inline pins and popups
graph.html             graph and HUD
base-layer.html        data-base-layer selection
```

## Troubleshooting

### `StgyTrackViewer is not defined`

The viewer bundle was not loaded.

Check:

```text
http://localhost:8000/dist/track-viewer.js
```

If it returns 404, start the HTTP server from the package root.

### `track-viewer.css` or `track-viewer.js` returns 404

Run:

```sh
npm run bundle
```

Then start the server from the package root.

```sh
npm run serve:examples
```

### `Track data MIME type is not supported`

Make sure you are using the current `loader.ts`.

The loader accepts `.trj`, `.json`, `.geojson`, `.trjgz`, and gzip MIME variants
such as `application/geo+json+gzip`.

### Browser still shows old behavior

Use hard reload.

When DevTools is open, disable cache and reload again.
