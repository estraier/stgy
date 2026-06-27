# STGY Track Viewer

STGY Track Viewer is a lightweight Leaflet-based track and map viewer for
embedding interactive maps in static HTML pages, articles, blogs, and custom
web applications.

It renders GeoJSON-compatible track data from simple HTML markup. It supports
inline pins, route layers, safe popups, per-coordinate route data, graph
inspection, multiple routes, original-data download links, and touch-friendly
interaction for mobile devices.

## Features

* Render maps from plain HTML markup.
* Load track data from:

  * DOM templates
  * GeoJSON-compatible URLs
  * JSON data URLs
  * gzip-compressed GeoJSON data URLs
* Show inline pins and GeoJSON `Point` features.
* Render GeoJSON `LineString` routes.
* Automatically fit the map to pins and routes.
* Respect explicitly specified center and zoom.
* Automatically switch map layers for Japan and overseas locations.
* Display safe popups with:

  * title
  * description
  * multiple links
  * multiple images
* Validate URL protocols for popup links and images.
* Display optional original-data download links.
* Display per-coordinate route data in a map overlay.
* Render graphs from `coordinateProperties`.
* Support distance, time, and sample-index graph axes.
* Support graph series such as elevation, heart rate, power, cadence, and speed.
* Support additional numeric graph series.
* Support multiple routes with active graph switching.
* Support desktop hover and mobile tap interactions.
* Pin route samples by clicking or tapping a route or graph.
* Clear pinned samples by clicking or tapping the map background.
* Show user-friendly error messages for unsupported or invalid track data.

## Demo

A comprehensive demo is available in `index.html`.

Build the viewer files first, then open `index.html` in a browser.

```sh
npm install
npm run test
npm run build
```

If no build script is configured, the viewer can be bundled with esbuild:

```sh
esbuild src/index.ts \
  --bundle \
  --minify \
  --outfile=dist/track-viewer.js \
  --format=iife \
  --global-name=StgyTrackViewer \
  --loader:.png=dataurl \
  --loader:.svg=dataurl
```

The build process should emit files that can be loaded by the demo page, such
as:

```text
dist/track-viewer.js
dist/track-viewer.css
```

## Quick Start

Include the generated JavaScript and CSS files:

```html
<link rel="stylesheet" href="./dist/track-viewer.css">
<script src="./dist/track-viewer.js"></script>
```

Add a map container:

```html
<figure class="stgy-track-map" style="height: 400px;" data-src="#track-data">
  <div class="stgy-track-canvas">Map loading...</div>
  <figcaption class="stgy-track-caption">Sample route</figcaption>
</figure>

<template id="track-data">
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [139.7528, 35.6852],
          [139.7550, 35.6848],
          [139.7585, 35.6840]
        ]
      },
      "properties": {
        "color": "#e67e22",
        "weight": 6,
        "opacity": 0.9
      }
    }
  ]
}
</template>
```

Initialize the viewer:

```html
<script>
  const renderer = new StgyTrackViewer.StgyTrackRenderer();
  renderer.hydrate();
</script>
```

## Usage

### Browser Bundle

When using the IIFE browser bundle, the renderer is available through the
global `StgyTrackViewer` object:

```html
<script src="./dist/track-viewer.js"></script>
<script>
  const renderer = new StgyTrackViewer.StgyTrackRenderer();
  renderer.hydrate();
</script>
```

By default, `hydrate()` scans `document.body`.

You can also pass a root element to hydrate only a specific part of the
document:

```js
const renderer = new StgyTrackViewer.StgyTrackRenderer();
renderer.hydrate(document.querySelector("#article"));
```

The renderer marks initialized figures with `data-stgy-track-initialized` and
skips them on later `hydrate()` calls. This makes repeated hydration safer in
CMS-like pages and partial-rendering workflows.

### Module Usage

The package exports the following public APIs:

```ts
import { StgyTrackRenderer, isJapan, JAPAN_AREAS } from "./src";

const renderer = new StgyTrackRenderer();
renderer.hydrate();
```

Adjust the import path according to your build setup or package entry point.

## HTML Structure

A map is defined by a `figure.stgy-track-map` element.

```html
<figure class="stgy-track-map" style="height: 400px;">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

Each `.stgy-track-map` must contain one `.stgy-track-canvas` element. The
canvas element is used as the Leaflet map container.

If the canvas element is missing, the viewer displays an error message and does
not initialize that map.

The map container must have an explicit height, either through inline style or
CSS. Without a height, Leaflet cannot render a visible map.

### Map Attributes

| Attribute                | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `data-src`               | Track data source. Supports DOM IDs, URLs, and data URLs. |
| `data-lat`               | Initial latitude.                                         |
| `data-lon`               | Initial longitude.                                        |
| `data-zoom`              | Initial zoom level.                                       |
| `data-show-overlay`      | Set to `false` to disable the map overlay.                |
| `data-show-graph`        | Set to `false` to disable the graph panel.                |
| `data-download-src`      | Optional original-data download URL.                      |
| `data-download-label`    | Optional download link label.                             |
| `data-download-filename` | Optional filename for the `download` attribute.           |

### View Behavior

When `data-lat`, `data-lon`, and `data-zoom` are all provided, the viewer
respects the specified view.

When the center is not provided, the viewer computes the initial center from
pins and track bounds.

When `data-zoom` is not provided, the viewer automatically fits all available
content into the map view.

If the computed bounds contain only a single point and `data-zoom` is not
provided, the viewer uses a default single-point zoom level.

## Data Sources

### `data-src`

A single track source can be specified directly on `.stgy-track-map`:

```html
<figure class="stgy-track-map" style="height: 400px;" data-src="#track-data">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

If `data-src` is present on `.stgy-track-map`, it is used as the single track
source and `.stgy-track-sources` inside the same figure are ignored.

### DOM Template Source

```html
<figure class="stgy-track-map" style="height: 400px;" data-src="#track-data">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>

<template id="track-data">
{
  "type": "FeatureCollection",
  "features": []
}
</template>
```

### URL Source

```html
<figure class="stgy-track-map" style="height: 400px;" data-src="./route.geojson">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

### Data URL Source

```html
<figure
  class="stgy-track-map"
  style="height: 400px;"
  data-src='data:application/json,{"type":"FeatureCollection","features":[]}'>
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

### Gzip-Compressed Data URL Source

The viewer supports gzip-compressed GeoJSON data URLs when the browser supports
gzip decoding.

```html
<figure
  class="stgy-track-map"
  style="height: 400px;"
  data-src="data:application/geo+json+gzip;base64,...">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

gzip-compressed data URLs require browser support for `DecompressionStream`.
When gzip decoding is not available, use an uncompressed GeoJSON-compatible
source.

### MIME Validation

Track data is validated before parsing. Unsupported MIME types are rejected and
reported as load errors.

JSON and GeoJSON-compatible MIME types should be used for uncompressed data.
gzip-compressed GeoJSON data should use a supported gzip GeoJSON MIME type.

## Original Data Download Links

The viewer can display an optional download link for original master data.

This is useful when the map displays a reduced digest file, while the original
source file remains available for download.

For example, a social networking service may store:

* the original FIT file as master data
* a reduced TrackJSON / GeoJSON-compatible digest for map rendering

The viewer can render the digest through `data-src` and expose the original file
through `data-download-src`.

```html
<figure
  class="stgy-track-map"
  style="height: 400px;"
  data-src="/maps/digests/112233/4c712e88c5542322.trjgz"
  data-download-src="/maps/masters/112233/4c712e88c5542322.fit"
  data-download-label="Download original FIT file"
  data-download-filename="ride.fit">
  <div class="stgy-track-canvas">Map loading...</div>
  <figcaption class="stgy-track-caption">Ride to Kamakura</figcaption>
</figure>
```

### Download Attributes

| Attribute                | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `data-download-src`      | URL of the original data file. No link is rendered when omitted. |
| `data-download-label`    | Link text. Defaults to `Download original data`.                 |
| `data-download-filename` | Optional filename for the `download` attribute.                  |

The download link is inserted as `.stgy-track-actions` inside the figure. When a
caption exists directly under the figure, the actions block is inserted after
the caption. Otherwise, it is appended to the figure.

```html
<div class="stgy-track-actions">
  <a class="stgy-track-download" href="/maps/masters/112233/ride.fit" download="ride.fit">
    Download original FIT file
  </a>
</div>
```

`data-download-src` uses the same safe URL normalization as popup media.
Relative URLs are allowed. Absolute URLs must use `http:` or `https:`.

Unsafe URLs such as `javascript:` and `data:` are ignored, and no download link
is rendered.

`data-download-filename` is optional. When it is omitted, the viewer does not
set the `download` attribute.

## Inline Pins

Inline pins can be defined with `.stgy-track-pins`.

```html
<figure class="stgy-track-map" style="height: 400px;">
  <div class="stgy-track-canvas">Map loading...</div>

  <details class="stgy-track-pins">
    <ul>
      <li
        data-lat="35.681"
        data-lon="139.767"
        data-color="#8e44ad"
        data-popup-width="40"
        data-popup-height="30">
        <div class="annot-title">Tokyo Station</div>
        <div class="annot-desc">This popup is generated from inline HTML.</div>
      </li>
    </ul>
  </details>
</figure>
```

### Inline Pin Attributes

| Attribute           | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `data-lat`          | Pin latitude.                                           |
| `data-lon`          | Pin longitude.                                          |
| `data-color`        | Pin color.                                              |
| `data-popup-width`  | Popup maximum width as a percentage of the map width.   |
| `data-popup-height` | Popup maximum height as a percentage of the map height. |

Popup width and height percentages are clamped to the range `1` to `99`.

### Inline Popup Classes

Supported inline popup classes are:

| Class          | Description            |
| -------------- | ---------------------- |
| `.annot-title` | Popup title.           |
| `.annot-desc`  | Popup description.     |
| `.annot-link`  | Popup link container.  |
| `.annot-image` | Popup image container. |

Inline pins can contain links and images:

```html
<li data-lat="35.681" data-lon="139.767">
  <div class="annot-title">Tokyo Station</div>
  <div class="annot-desc">Inline popup with media.</div>
  <div class="annot-link">
    <a href="https://example.com">Details</a>
  </div>
  <div class="annot-image">
    <img src="https://placehold.co/300x180" alt="Example image">
  </div>
</li>
```

Link and image URLs are normalized and filtered in the same way as GeoJSON
popup media.

## Track Sources

Multiple track sources can be defined with `.stgy-track-sources`.

```html
<figure class="stgy-track-map" style="height: 400px;">
  <div class="stgy-track-canvas">Map loading...</div>

  <ul class="stgy-track-sources">
    <li><a href="#route-a" class="track-source">Route A</a></li>
    <li><a href="#route-b" class="track-source">Route B</a></li>
  </ul>
</figure>
```

Each `a.track-source` uses its `href` as a track data source.

### Guide Pin Mode

Set `data-render="pin"` on a track source to show it as a representative guide
pin. Clicking the guide pin toggles the full route layer.

```html
<ul class="stgy-track-sources">
  <li>
    <a href="#route-data" class="track-source" data-render="pin">
      Running route
    </a>
  </li>
</ul>
```

Guide pin mode is useful for overview maps where many tracks should be
available but not all routes should be visible initially.

## GeoJSON Support

The viewer passes GeoJSON data to Leaflet, so basic Leaflet-supported
geometries may render.

Viewer-specific behavior is focused on `Point` and `LineString` features:

| Geometry     | Viewer-specific behavior                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `Point`      | Rendered as a marker. Supports custom color and popup properties.        |
| `LineString` | Rendered as a route. Supports style, popup, overlay, and graph behavior. |

`coordinateProperties` interaction and graph rendering are supported only for
`LineString` features.

## GeoJSON Properties

STGY Track Viewer supports standard GeoJSON features and additional optional
properties.

### Common Properties

| Property               | Type   | Description                                  |
| ---------------------- | ------ | -------------------------------------------- |
| `title`                | string | Popup title.                                 |
| `description`          | string | Popup description.                           |
| `color`                | string | Route or pin color.                          |
| `weight`               | number | Route stroke width.                          |
| `opacity`              | number | Route stroke opacity.                        |
| `popupWidth`           | number | Popup maximum width as a percentage.         |
| `popupHeight`          | number | Popup maximum height as a percentage.        |
| `links`                | array  | Popup links.                                 |
| `images`               | array  | Popup images.                                |
| `coordinateProperties` | object | Per-coordinate data for overlays and graphs. |

Popup width and height percentages are clamped to the range `1` to `99`.

### Color Values

Supported color values are:

* `#RGB`
* `#RRGGBB`
* `red`
* `green`
* `blue`
* `orange`
* `purple`
* `gold`
* `black`
* `white`
* `gray`
* `grey`

Unsupported values fall back to the default color.

### Route Style Defaults

When route style properties are omitted or invalid, the viewer uses default
style values.

| Property  | Default   |
| --------- | --------- |
| `color`   | `#0078A8` |
| `weight`  | `4`       |
| `opacity` | `0.8`     |

## Popup Links

Links can be strings:

```json
{
  "links": [
    "https://example.com"
  ]
}
```

Or objects with `href` and `text`:

```json
{
  "links": [
    {
      "href": "https://example.com/detail",
      "text": "Details"
    }
  ]
}
```

Only `http:` and `https:` URLs are accepted.

Unsafe URLs such as `javascript:` and `data:` are ignored.

## Popup Images

Images can be strings:

```json
{
  "images": [
    "https://placehold.co/200x120"
  ]
}
```

Or objects with `src` and `alt`:

```json
{
  "images": [
    {
      "src": "https://placehold.co/300x180",
      "alt": "Example image"
    }
  ]
}
```

Only `http:` and `https:` URLs are accepted.

Unsafe image URLs are ignored.

## Per-Coordinate Data

`coordinateProperties` attaches data arrays to each coordinate of a
`LineString`.

Each array must have the same length as the route coordinate array.

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [139.7528, 35.6852],
      [139.7550, 35.6848],
      [139.7585, 35.6840]
    ]
  },
  "properties": {
    "color": "#e67e22",
    "weight": 6,
    "opacity": 0.9,
    "coordinateProperties": {
      "times": [1767222000, 1767222060, 1767222120],
      "distances": [0, 210, 545],
      "elevations": [20, 21, 22],
      "heartRates": [118, 123, 128],
      "cadences": [72, 75, 78],
      "powers": [130, 145, 160],
      "speeds": [18.5, 19.2, 20.1]
    }
  }
}
```

### Built-In Fields

| Field        | Unit / Meaning                             |
| ------------ | ------------------------------------------ |
| `times`      | Unix timestamp in seconds or milliseconds. |
| `distances`  | Meters.                                    |
| `elevations` | Meters.                                    |
| `heartRates` | Beats per minute.                          |
| `cadences`   | Revolutions per minute.                    |
| `powers`     | Watts.                                     |
| `speeds`     | Kilometers per hour.                       |

The map overlay displays known built-in fields such as time, distance,
elevation, heart rate, cadence, power, and speed.

Additional numeric arrays are available as graph series but are not
automatically shown in the map overlay.

### Graph Axis Rules

`distances` and `times` are used as graph X axes and are not shown as graph
series.

Other numeric arrays with the same length as the route coordinates are shown as
selectable graph series.

The default X axis is selected in this order:

1. `distances`
2. `times`
3. sample index

When neither `distances` nor `times` is available, the graph uses the coordinate
sample index as the X axis.

## Graph Interaction

When a route has valid `coordinateProperties`, the viewer creates a graph panel.

On desktop:

* Hover over a route to inspect the nearest sample.
* Hover over the graph to inspect a sample.
* Click a route or graph to pin the selected sample.
* Click the map background to clear the pinned sample.

On mobile:

* Tap a route or graph to pin a sample.
* Drag on the graph to update the pinned sample.
* Tap the map background to clear the pinned sample.

The graph panel can be disabled with:

```html
<figure
  class="stgy-track-map"
  data-src="#track-data"
  data-show-graph="false">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

## Overlay Interaction

The map overlay can be disabled with:

```html
<figure
  class="stgy-track-map"
  data-src="#track-data"
  data-show-overlay="false">
  <div class="stgy-track-canvas">Map loading...</div>
</figure>
```

When `data-show-overlay="false"` is set:

* The bottom-left overlay is not created.
* The map sample marker still works.
* Graph interaction still works.

When `data-show-graph="false"` is set:

* The graph panel is not created.
* The map overlay still works.
* The map sample marker still works.

## Multiple Routes

When multiple routes have `coordinateProperties`, the first valid route is used
as the initial active graph.

Clicking another route switches the active graph to that route and highlights
the active route.

Hovering an inactive route shows the map marker and overlay for that route, but
does not move the graph cursor. Click the route to make it active and switch the
graph.

## Map Layers

The viewer uses different base layers depending on the initial map center.

For Japan, the viewer includes:

* GSI Pale
* GSI Standard
* GSI Photo
* CyclOSM
* OpenStreetMap
* OpenTopoMap

For locations outside Japan, the viewer includes:

* CyclOSM
* OpenStreetMap
* OpenTopoMap

Default Leaflet marker icons are loaded from the Leaflet package CDN. Custom
colored pins are rendered as inline SVG icons.

## Error Handling

The viewer displays an error message on the map when track data cannot be
loaded or parsed.

Typical error cases include:

* Missing `.stgy-track-canvas`.
* Unsupported MIME type.
* Invalid JSON.
* Missing DOM template.
* Failed network request.
* Unsupported gzip decoding environment.

Invalid optional download URLs do not display an error message. The download
link is simply omitted.

## Security

STGY Track Viewer avoids injecting raw HTML from GeoJSON properties into
popups.

Popup text fields are rendered as text content. Popup link and image URLs are
validated, and only `http:` and `https:` URLs are accepted.

Download link URLs are also validated. Relative URLs are accepted, while unsafe
absolute URLs such as `javascript:` and `data:` are ignored.

This prevents common script injection vectors such as `javascript:` URLs,
unsafe `data:` URLs, and inline HTML execution through popup fields.

Supported popup classes are intentionally limited to:

* `.annot-title`
* `.annot-desc`
* `.annot-link`
* `.annot-image`

## Browser Support

STGY Track Viewer targets modern browsers with Leaflet support.

gzip-compressed data URLs require browser support for `DecompressionStream`.
When gzip decoding is not available, uncompressed GeoJSON-compatible sources
should be used.

Touch interaction depends on Pointer Events support for graph dragging.

## Development

Install dependencies:

```sh
npm install
```

Run tests:

```sh
npm run test
```

Build the viewer:

```sh
npm run build
```

If no build script is configured, use esbuild directly:

```sh
esbuild src/index.ts \
  --bundle \
  --minify \
  --outfile=dist/track-viewer.js \
  --format=iife \
  --global-name=StgyTrackViewer \
  --loader:.png=dataurl \
  --loader:.svg=dataurl
```

## Project Structure

```text
src/
  areas.ts
  geo.ts
  index.ts
  loader.ts
  renderer.ts
  stgy-track.css
```

Typical test files:

```text
src/
  geo.test.ts
  loader.test.ts
  renderer.test.ts
```

## Testing Checklist

Before submitting changes, check the following:

* `npm run test` passes.
* `index.html` works in a desktop browser.
* The demo works in mobile browser mode.
* Route hover shows the map marker and overlay.
* Graph hover shows the corresponding map marker and overlay.
* Route click or tap pins a sample.
* Graph click, tap, or drag pins a sample.
* Map background click or tap clears the pinned sample.
* Multiple routes switch the active graph correctly.
* Popup links and images reject unsafe URLs.
* Original-data download links are shown only when `data-download-src` is valid.
* Download labels and filenames are reflected correctly.
* Error messages are shown for invalid track sources.

## Contributing

Contributions are welcome.

Before submitting a change:

1. Add or update tests for behavior changes.
2. Run the test suite.
3. Check the demo page in a desktop browser.
4. Check route tap, graph drag, and background tap behavior in mobile mode or
   on a real mobile device.

Please keep changes focused and avoid mixing unrelated refactors with feature
changes.

## License

Add the project license here.

For example:

```text
MIT License
```
