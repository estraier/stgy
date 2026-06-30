# Testing stgy-track

This document lists automated and manual checks for `stgy-track`.

The automated tests cover most pure logic. Manual checks are still useful for
Leaflet rendering, browser APIs, layout, downloads, and cache-related issues.

## Commands

Run the full test suite.

```sh
npm run test
```

Run type checking and linting.

```sh
npm run check
npm run lint
```

Build browser bundles.

```sh
npm run bundle
```

After changing `src/renderer.ts`, `src/fit-demo.ts`, `src/trackjson.ts`, or CSS,
always rebuild the browser bundle.

```sh
npm run bundle
```

Browsers may keep an old `dist/track-viewer.js` or `dist/fit-demo.js`.
Use hard reload when testing in a browser.

## Automated test coverage

Important test files:

```text
src/geo.test.ts
src/loader.test.ts
src/renderer.test.ts
src/fit.test.ts
src/trackjson.test.ts
```

### `geo.test.ts`

Covers Japan bounding boxes and default map region decisions.

Checks include:

```text
Tokyo / Osaka / Sapporo / Fukuoka / Naha
Tsushima vs Busan
Yonaguni vs Taipei
Soya vs Sakhalin
Ogasawara / Minamitorishima / Okinotorishima
Honolulu / London / Beijing
```

### `loader.test.ts`

Covers TrackJSON loading from DOM and URL-like sources.

Checks include:

```text
DOM template loading
data:application/json loading
missing DOM id errors
invalid / empty DOM source errors
```

### `renderer.test.ts`

Covers renderer behavior in jsdom.

Checks include:

```text
GSI Pale appears for Japan
fitBounds when no data-zoom is provided
setView when data-zoom is provided
```

### `fit.test.ts`

Covers FIT parsing, FIT downsampling, and FIT to TrackJSON conversion.

Checks include:

```text
invalid FIT input
FIT decoder errors and warnings
record parsing
metadata extraction
uniform downsampling
aggregate downsampling
endpoint preservation
zero values in aggregate averages
custom metrics
TrackJSON metadata output
TrackJSON numeric precision
fill-forward for heartRates / cadences / powers
```

### `trackjson.test.ts`

Covers pure TrackJSON helper logic.

Checks include:

```text
TrackJSON parse
FeatureCollection and Feature roots
invalid roots
positioned point counting
title and metadata extraction
uniform downsampling
aggregate downsampling
coordinate and coordinateProperties sync
zero values in aggregate averages
numeric compaction
precision overrides
```

## Manual browser checks

Run `npm run bundle` before starting.

Open the relevant demo or local page in a browser. Use hard reload after each
bundle rebuild.

### Basic map rendering

Check:

```text
A map appears inside .stgy-track-map
Leaflet tiles load
No console error appears
The map fills the expected container area
The caption remains visible
```

Expected:

```text
The map renders without layout collapse.
```

### Japan default base layer

Use a track or map centered in Japan.

Check:

```text
Tokyo or another Japan location loads
GSI Pale is the default base layer
GSI Standard and GSI Photo are available in the layer switcher
CyclOSM, OpenStreetMap, and OpenTopoMap are also available
```

Expected:

```text
Japan maps use GSI Pale by default.
```

### Outside-Japan default base layer

Use a track or map centered outside Japan.

Check:

```text
London, Honolulu, or another outside-Japan location loads
CyclOSM is the default base layer
GSI layers are not selected as the default
```

Expected:

```text
Outside-Japan maps use CyclOSM by default.
```

### Inline pins

Use a page with `.stgy-track-pins`.

Check:

```text
Pins appear at expected locations
Popup title appears
Popup description appears
Popup link works
Popup image appears when provided
Unsafe URLs are not used
```

Expected:

```text
Inline pins render safely and popups do not inject unsafe HTML.
```

### Single `.trj` source

Use a `figure.stgy-track-map` with `data-src` pointing to a `.trj` file.

Check:

```text
Route line appears
Bounds fit the route when data-zoom is omitted
Configured color, weight, and opacity are applied
No console error appears
```

Expected:

```text
Raw TrackJSON loads and renders.
```

### Single `.trjgz` source

Use a `figure.stgy-track-map` with `data-src` pointing to a `.trjgz` file.

Check:

```text
Route line appears
The browser can decompress the file
No console error appears
```

Expected:

```text
Compressed TrackJSON loads and renders in browsers with DecompressionStream.
```

If the browser does not support `DecompressionStream("gzip")`, an error is
expected.

### Multiple track sources

Use `.stgy-track-sources` with multiple `.track-source` entries.

Check:

```text
All listed routes can load
Layer colors are applied
Clicking routes updates the active route
The graph follows the active route
```

Expected:

```text
Multiple route sources can coexist.
```

### Track source rendered as pin

Use a `.track-source` with `data-render="pin"`.

Check:

```text
A representative pin appears
Clicking the pin toggles the route
Clicking again hides or updates the route as expected
Popup content is safe
```

Expected:

```text
Pin-first track rendering works.
```

### Original file download link

Use `data-download-src`.

Check:

```text
Download link appears below or near the map
The label uses data-download-label when provided
The download filename uses data-download-filename when provided
Unsafe URLs are rejected
```

Expected:

```text
Original/master download link appears only for safe URLs.
```

## FIT demo checks

Open `fit-demo.html` after running `npm run bundle`.

### FIT input

Upload a `.fit` file.

Check:

```text
The file is parsed
Summary shows FIT as the source type
Metadata appears when available
Warnings count appears when available
A route appears on the map
TrackJSON output appears
Download TrackJSON link appears
Compressed link appears when CompressionStream is supported
```

Expected:

```text
FIT converts to compact TrackJSON and renders.
```

### `.trj` input

Upload a `.trj` file.

Check:

```text
The file is parsed as TrackJSON
Summary shows TrackJSON as the source type
A route appears on the map
Download TrackJSON saves a .trj file
```

Expected:

```text
Raw TrackJSON can be loaded, rendered, compacted, and downloaded.
```

### `.json` or `.geojson` input

Upload a `.json` or `.geojson` TrackJSON file.

Check:

```text
The file is parsed as TrackJSON
A route appears on the map
Download TrackJSON saves a .trj file
```

Expected:

```text
Legacy JSON extensions are accepted, but the output extension is .trj.
```

### `.trjgz` input

Upload a `.trjgz` file.

Check:

```text
The file is decompressed
The file is parsed as TrackJSON
A route appears on the map
Downsampling applies when enabled
Compaction applies before download
Download TrackJSON saves a .trj file
Compressed download saves a .trjgz file
```

Expected:

```text
Compressed TrackJSON can be loaded, downsampled, compacted, and re-exported.
```

### Downsampling disabled

Turn off `Downsample input`.

Upload a FIT or TrackJSON file.

Check:

```text
Rendered point count equals original positioned point count
The route shape is not reduced
```

Expected:

```text
No downsampling is applied.
```

### Uniform downsampling

Turn on `Downsample input`.

Set:

```text
Strategy: Uniform
Max points: a small value such as 100
Preserve endpoints: checked
```

Upload FIT, `.trj`, or `.trjgz`.

Check:

```text
Rendered point count is at most Max points
Start point is preserved
End point is preserved
Route uses selected original samples
```

Expected:

```text
Uniform downsampling keeps selected original samples.
```

### Aggregate downsampling

Turn on `Downsample input`.

Set:

```text
Strategy: Aggregate
Max points: a small value such as 100
Preserve endpoints: checked
```

Upload FIT, `.trj`, or `.trjgz`.

Check:

```text
Rendered point count is at most Max points
Start point is preserved
End point is preserved
Sensor values are smoother than uniform
Coordinates use representative middle samples
Time and distance use representative samples
Measured series are averaged
```

Expected:

```text
Aggregate downsampling preserves route endpoints and averages measured values.
```

### Numeric compaction

Upload FIT or TrackJSON and inspect the downloaded `.trj`.

Check:

```text
coordinates have about 5 decimal places
times are integers
distances have 1 decimal place
elevations have 1 decimal place
heartRates have 1 decimal place at most
cadences have 1 decimal place at most
powers have 1 decimal place at most
speeds have 1 decimal place
metadata totalDistanceM has 1 decimal place
metadata totalElapsedTime and totalTimerTime are integers
```

Expected:

```text
Downloaded TrackJSON is compact and does not retain excessive numeric precision.
```

### Download extensions

Check the file names generated by the demo.

Expected:

```text
Raw TrackJSON download: .trj
Compressed TrackJSON download: .trjgz
```

### Pretty output

Turn on pretty output.

Check:

```text
TrackJSON textarea contains indented JSON
Downloaded .trj is also pretty-printed
```

Turn off pretty output.

Check:

```text
TrackJSON textarea contains compact JSON
Downloaded .trj is compact JSON
```

Expected:

```text
Pretty output controls JSON formatting only, not route data.
```

## Graph checks

Use TrackJSON with `coordinateProperties`.

### Graph appears

Check:

```text
Graph panel appears below the map
Y series selector appears
X axis selector appears
Smoothing selector appears
```

Expected:

```text
Graph controls appear when graphable coordinateProperties exist.
```

### X axis selection

Try:

```text
distance
time
sample
```

Expected:

```text
The graph redraws with the selected X axis.
```

### Y series selection

Try:

```text
elevations
heartRates
cadences
powers
speeds
```

Expected:

```text
The graph redraws with the selected Y series.
```

### Smoothing

Try smoothing windows:

```text
1
3
11
31
121
```

Check:

```text
The graph line changes as smoothing increases
The hover point Y value follows the smoothed value
The HUD remains raw and does not change because of smoothing
```

Expected:

```text
Smoothing affects only the graph display.
```

### Graph ticks

Check:

```text
Distance ticks show km
Elevation ticks show m
Heart rate ticks show bpm
Cadence ticks show rpm
Power ticks show W
Speed ticks show km/h
Y grid lines are horizontal only
X grid lines are not shown
Tick labels are small
```

Expected:

```text
Ticks and units match the selected axes.
```

### Y axis minimum

For these series:

```text
elevations
heartRates
cadences
powers
speeds
```

Check:

```text
Y axis starts at 0
```

For custom numeric series:

```text
Y axis follows the sample range
```

Expected:

```text
Standard series use zero-based Y axes; custom series do not.
```

## Coordinate HUD checks

Use a route with `coordinateProperties`.

Check:

```text
Moving pointer over the route updates the HUD
Distance appears
Time appears when available
Elevation appears when available
Heart rate appears when available
Cadence appears when available
Power appears when available
Speed appears when available
```

Expected:

```text
HUD displays nearest raw sample values.
```

## Responsive layout checks

Check at desktop and narrow widths.

Suggested widths:

```text
1280 px
768 px
390 px
```

Check:

```text
Map remains usable
Graph does not overflow badly
Controls wrap or remain usable
Download links remain clickable
Popup content remains readable
```

Expected:

```text
The viewer remains usable on mobile-sized screens.
```

## Security checks

Use malicious or unusual input in pins and TrackJSON properties.

Check:

```text
javascript: links are rejected
Inline event handlers are not executed
HTML in title or description is escaped or ignored
Unsafe image URLs are rejected
data-download-src rejects unsafe URLs
Unknown TrackJSON properties do not break rendering
```

Expected:

```text
Untrusted content is not executed as script.
```

## Browser cache checklist

When a browser result looks stale:

```text
Run npm run bundle
Hard reload the page
Check the Network tab for dist/track-viewer.js and dist/fit-demo.js
Disable cache while DevTools is open
Confirm the timestamp or file size changed
```

Expected:

```text
The browser uses the latest bundle.
```

## Release checklist

Before publishing or tagging a version:

```text
npm run test
npm run check
npm run lint
npm run bundle
```

Then manually check:

```text
basic map
.trj loading
.trjgz loading
FIT upload
TrackJSON upload
uniform downsampling
aggregate downsampling
raw .trj download
compressed .trjgz download
graph controls
HUD
mobile width
unsafe URL rejection
```
