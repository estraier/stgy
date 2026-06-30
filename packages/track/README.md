# stgy-track

`stgy-track` is a TypeScript / Leaflet based track viewer for embedding maps,
pins, routes, and activity graphs in HTML pages.

It renders TrackJSON, a GeoJSON-compatible route format, and includes a FIT demo
that can convert FIT files to TrackJSON.

## Features

- Leaflet map rendering
- Japan-aware default base map selection
  - GSI Pale inside Japan
  - CyclOSM outside Japan
- Base layer switcher
  - GSI Pale
  - GSI Standard
  - GSI Photo
  - CyclOSM
  - OpenStreetMap
  - OpenTopoMap
- Inline pins with safe title, description, links, and images
- TrackJSON loading from `.json` and `.geojson`
- gzip-compressed TrackJSON loading from `.trjgz`
- Optional original/master file download link
- Coordinate HUD for route samples
- Graph panel for route sample data
- FIT to TrackJSON conversion demo
- Raw TrackJSON and compressed `.trjgz` downloads
- Uniform and aggregate downsampling for FIT conversion

## Development

```sh
npm install
npm run test
npm run bundle
```

Useful scripts:

```sh
npm run build
npm run check
npm run test
npm run lint
npm run bundle
```

`npm run bundle` builds the browser bundles.

```text
dist/track-viewer.js
dist/fit-demo.js
```

## Basic usage

```html
<figure
  class="stgy-track-map"
  data-src="/tracks/ride.trjgz"
  data-download-src="/masters/ride.fit"
  data-download-label="Download original FIT file"
  data-download-filename="ride.fit">
  <div class="stgy-track-canvas">Map loading...</div>
  <figcaption class="stgy-track-caption">Ride to Kamakura</figcaption>
</figure>

<script src="/dist/track-viewer.js"></script>
<script>
  new StgyTrackViewer.StgyTrackRenderer().hydrate();
</script>
```

`data-src` can point to raw TrackJSON or compressed TrackJSON.

```text
/tracks/ride.json
/tracks/ride.geojson
/tracks/ride.trjgz
```

`.trjgz` is gzip-compressed TrackJSON.

## Map attributes

`figure.stgy-track-map` supports these attributes.

| Attribute | Description |
| --- | --- |
| `data-src` | TrackJSON or `.trjgz` URL |
| `data-lat` | Initial center latitude |
| `data-lon` | Initial center longitude |
| `data-zoom` | Initial zoom |
| `data-show-overlay` | Set `false` to hide the coordinate HUD |
| `data-show-graph` | Set `false` to hide the graph panel |
| `data-download-src` | Original/master file download URL |
| `data-download-label` | Download link label |
| `data-download-filename` | Download filename |

When `data-lat` or `data-lon` is omitted, the map center is computed from
pins and track bounds.

When `data-zoom` is omitted, the map uses `fitBounds`.

## Inline pins

```html
<figure class="stgy-track-map" data-lat="35.681" data-lon="139.767" data-zoom="13">
  <div class="stgy-track-canvas">Map loading...</div>

  <ul class="stgy-track-pins">
    <li data-lat="35.681236" data-lon="139.767125" data-color="#e74c3c">
      <div class="annot-title">Tokyo Station</div>
      <div class="annot-desc">A major railway terminal in Tokyo.</div>
      <div class="annot-link">
        <a href="https://example.com/">More information</a>
      </div>
    </li>
  </ul>
</figure>
```

Popup content can use these classes.

```text
.annot-title
.annot-desc
.annot-link
.annot-image
```

## Multiple track sources

Use `.stgy-track-sources` when a figure has multiple track files.

```html
<figure class="stgy-track-map">
  <div class="stgy-track-canvas">Map loading...</div>

  <div class="stgy-track-sources">
    <a class="track-source" href="/tracks/day-1.trjgz">Day 1</a>
    <a class="track-source" href="/tracks/day-2.trjgz">Day 2</a>
  </div>
</figure>
```

Use `data-render="pin"` to show a track as a representative pin first.

```html
<a class="track-source" href="/tracks/ride.trjgz" data-render="pin">Ride</a>
```

Clicking that pin toggles the route.

## TrackJSON

TrackJSON is a GeoJSON `FeatureCollection`.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [139.767125, 35.681236],
          [139.768000, 35.682000]
        ]
      },
      "properties": {
        "title": "Ride to Kamakura",
        "color": "#0078A8",
        "weight": 4,
        "opacity": 0.8,
        "coordinateProperties": {
          "times": [1710000000, 1710000001],
          "distances": [0, 8.3],
          "elevations": [12.3, 12.5],
          "heartRates": [120, 121],
          "cadences": [80, 82],
          "powers": [150, 170],
          "speeds": [25.1, 26.4]
        }
      }
    }
  ]
}
```

Coordinates follow GeoJSON order: `[lon, lat]`.

Each array in `coordinateProperties` should have the same length as
`geometry.coordinates`.

Standard coordinate properties:

| Name | Unit | Description |
| --- | --- | --- |
| `times` | seconds or milliseconds | Unix timestamp |
| `distances` | m | Distance from start |
| `elevations` | m | Elevation |
| `heartRates` | bpm | Heart rate |
| `cadences` | rpm | Cadence |
| `powers` | W | Power |
| `speeds` | km/h | Speed |

## TrackJSON metadata

TrackJSON can store metadata in `Feature.properties.metadata`.

FIT conversion writes FIT-derived metadata there when
`includeMetadata` is not `false`.

```json
{
  "properties": {
    "title": "Ride to Kamakura",
    "metadata": {
      "source": {
        "type": "fit"
      },
      "sport": "cycling",
      "subSport": "road",
      "startTime": 1710000000,
      "totalDistanceM": 12345.6,
      "totalTimerTime": 3600,
      "totalElapsedTime": 3900,
      "device": {
        "manufacturer": "garmin",
        "product": "edge",
        "serialNumber": 123456789
      }
    }
  }
}
```

The renderer ignores unknown properties, so adding `metadata` does not break
existing rendering.

## Compressed TrackJSON

`.trjgz` is gzip-compressed TrackJSON.

```text
ride.json   raw TrackJSON
ride.trjgz  gzip-compressed TrackJSON
```

The viewer uses `DecompressionStream("gzip")` for `.trjgz` loading.

The FIT demo adds a compressed download link beside the raw TrackJSON download.

```text
Download TrackJSON  (compressed)
```

`Download TrackJSON` saves a raw `.json` file.

`(compressed)` saves a gzip-compressed `.trjgz` file. If the browser does not
support `CompressionStream("gzip")`, the compressed link is hidden.

## Coordinate HUD

When the pointer is over a route, the nearest sample is displayed in the HUD.

Displayed values:

```text
times
distances
elevations
heartRates
cadences
powers
speeds
```

The HUD shows raw `coordinateProperties` values. Graph smoothing does not affect
the HUD.

## Graph panel

When a route has `coordinateProperties`, the viewer shows a graph panel.

X axis choices:

```text
distance
time
sample
```

Y series choices include:

```text
elevations
heartRates
cadences
powers
speeds
custom numeric series
```

Clicking a route activates the graph for that route.

### Graph smoothing

The graph supports centered moving average smoothing.

Available windows:

```text
1, 3, 5, 7, 11, 15, 31, 61, 121
```

`1` means no smoothing.

Smoothing affects only:

```text
graph line
graph hover point
graph readout Y value
```

Smoothing does not affect:

```text
TrackJSON
coordinateProperties
HUD
map marker position
X axis
```

At the edges, only existing samples are averaged. The implementation does not
zero-fill missing edge samples.

### Graph ticks

Graph ticks are generated automatically with nice steps.

Current behavior:

- Tick labels use integer formatting
- Distance ticks include `km`
- Elevation ticks include `m`
- Heart rate ticks include `bpm`
- Cadence ticks include `rpm`
- Power ticks include `W`
- Speed ticks include `km/h`
- Y ticks have horizontal grid lines
- X ticks do not have vertical grid lines
- Tick labels are intentionally small

For these standard series, the Y axis minimum is fixed to `0`.

```text
elevations
heartRates
cadences
powers
speeds
```

For other custom numeric series, the Y axis range is based on the sample range.

## FIT demo

`fit-demo.html` can load and render:

```text
.fit
.json
.geojson
.trjgz
```

For FIT input, the demo parses the FIT file, optionally downsamples it, converts
it to TrackJSON, and renders it.

For `.json` and `.geojson` input, the demo renders the TrackJSON directly.

For `.trjgz` input, the demo decompresses the gzip data and renders the
TrackJSON.

The demo can also copy TrackJSON, download raw `.json`, and download compressed
`.trjgz`.

## FIT conversion API

`src/fit.ts` provides these functions.

```ts
export function parseFitBytes(
  bytes: ArrayBuffer | Uint8Array,
  options?: ParseFitOptions
): TrackActivity;

export function downsampleTrackActivity(
  activity: TrackActivity,
  options?: DownsampleTrackOptions
): TrackActivity;

export function trackActivityToTrackJson(
  activity: TrackActivity,
  options?: TrackJsonOptions
): string;
```

The intermediate type is `TrackActivity`.

```ts
export type TrackActivity = {
  schemaVersion: 1;
  metadata: TrackActivityMetadata;
  points: TrackPoint[];
  warnings: TrackWarning[];
};
```

This type is source-agnostic and can be reused for future formats such as TCX.

## Downsampling

`downsampleTrackActivity()` supports two strategies.

```ts
export type DownsampleTrackOptions = {
  maxPoints?: number;
  strategy?: "uniform" | "aggregate";
  preserveEndpoints?: boolean;
};
```

### uniform

`uniform` keeps selected original samples as-is.

```text
p0 p1 p2 p3 p4 p5 p6 p7 p8 p9
↓ maxPoints = 4
p0       p3       p6       p9
```

Characteristics:

- Simple
- Keeps original points unchanged
- Safe for route geometry
- Discards sensor values from skipped samples

### aggregate

`aggregate` divides the original points into buckets and creates one
representative point for each bucket.

For each bucket:

```text
lat/lon    representative middle sample
time       representative middle sample
distanceM  representative middle sample
elevation  average
heartRate  average
cadence    average
power      average
speed      average
temperature average
metrics    average
```

`0` is treated as a valid value. `undefined` is ignored.

Speed is currently a simple average.

### preserveEndpoints

`preserveEndpoints` keeps the first and last original points.

```ts
downsampleTrackActivity(activity, {
  maxPoints: 10000,
  strategy: "aggregate",
  preserveEndpoints: true,
});
```

For `aggregate + preserveEndpoints`:

```text
first point   original first point
last point    original last point
middle points aggregate buckets
```

For SNS route digests, `preserveEndpoints: true` is usually the best default.

## TrackJSON conversion options

```ts
export type TrackJsonOptions = {
  title?: string;
  description?: string;
  color?: string;
  weight?: number;
  opacity?: number;
  includeMetrics?: boolean;
  includeMetadata?: boolean;
  pretty?: boolean;
  precision?: TrackJsonPrecisionOptions;
};

export type TrackJsonPrecisionOptions = {
  coordinates?: number;
  times?: number;
  distances?: number;
  elevations?: number;
  heartRates?: number;
  cadences?: number;
  powers?: number;
  speeds?: number;
  metrics?: number;
  metadata?: number;
};
```

`includeMetadata` controls whether `TrackActivity.metadata` is written to
`Feature.properties.metadata`.

`includeMetrics` controls whether custom numeric metrics are written to
`coordinateProperties`.

## TrackJSON output precision

`trackActivityToTrackJson()` rounds numeric values only when emitting TrackJSON.
The internal `TrackActivity` values and downsampling calculations keep their
original precision.

Default output precision:

| Field | Precision |
| --- | --- |
| coordinates | 5 decimal places |
| times | integer |
| distances | 1 decimal place |
| elevations | 1 decimal place |
| heartRates | 1 decimal place |
| cadences | 1 decimal place |
| powers | 1 decimal place |
| speeds | 1 decimal place |
| metrics | 1 decimal place |
| metadata `totalDistanceM` | 1 decimal place |
| metadata `totalElapsedTime` | integer |
| metadata `totalTimerTime` | integer |
| metadata `createdAt` | integer |
| metadata `startTime` | integer |
| metadata device `serialNumber` | unchanged integer |

Coordinate precision of 5 decimal places is roughly meter-level precision.
Reducing numeric precision makes both raw `.json` and compressed `.trjgz`
smaller.

## Fill-forward behavior

FIT records sometimes omit heart rate, cadence, or power values for individual
samples.

TrackJSON generation fill-forwards these series:

```text
heartRates
cadences
powers
```

Missing values before the first valid value become `0`.

If a series has no valid value at all, the series is omitted.

These series are not fill-forwarded:

```text
times
distances
elevations
speeds
custom metrics
```

## Public exports

```ts
export { StgyTrackRenderer } from "./renderer";
export { isJapan } from "./geo";
export { JAPAN_AREAS } from "./areas";
```

Browser bundle usage:

```js
new StgyTrackViewer.StgyTrackRenderer().hydrate();
```

## Browser support notes

`.trjgz` loading uses `DecompressionStream("gzip")`.

Compressed TrackJSON download in the FIT demo uses `CompressionStream("gzip")`.

Browsers without these APIs may not support `.trjgz` upload/download in the demo.

## License

Add license information here.
