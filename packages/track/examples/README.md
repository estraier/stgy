# stgy-track examples

Run the browser bundle first.

```sh
npm run bundle
```

Then open `examples/index.html` in a browser.

## Files

```text
index.html
simple-track.html
compressed-track.html
multi-track.html
pin.html
graph.html
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
```

The examples expect browser bundles at:

```text
../dist/track-viewer.css
../dist/track-viewer.js
```

If the page looks stale after rebuilding, use hard reload.
