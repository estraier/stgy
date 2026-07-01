# TrackJSON

TrackJSON is the route data format used by `stgy-track`.

It is based on GeoJSON and uses a `FeatureCollection` containing one or more
`LineString` features. It adds optional route styling, metadata, and
per-coordinate sample series through `Feature.properties.coordinateProperties`.

## File extensions

Preferred extensions:

```text
.trj    raw TrackJSON
.trjgz  gzip-compressed TrackJSON
```

Accepted legacy or compatible extensions:

```text
.json
.geojson
```

`.trj` is the preferred extension for raw TrackJSON.

`.trjgz` is a gzip-compressed `.trj` file.

## MIME types

Recommended MIME types:

```text
.trj    application/json
.trjgz  application/gzip
```

Some simple HTTP servers may serve `.trj` as `application/octet-stream`.

The viewer accepts TrackJSON by extension, so `.trj`, `.json`, and `.geojson`
are accepted even when the MIME type is generic.

The viewer also accepts `.trjgz` by extension.

## Root object

The preferred root is a GeoJSON `FeatureCollection`.

```json
{
  "type": "FeatureCollection",
  "features": []
}
```

A single GeoJSON `Feature` may be accepted by helper functions, but generated
TrackJSON should use `FeatureCollection`.

## Feature

A route feature should be a GeoJSON `Feature` with a `LineString` geometry.

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [139.76713, 35.68124],
      [139.768, 35.682]
    ]
  },
  "properties": {}
}
```

## Coordinates

Coordinates follow GeoJSON order.

```text
[longitude, latitude]
```

Optional altitude may be present as the third value.

```text
[longitude, latitude, elevation]
```

However, the preferred representation is to store elevation in
`coordinateProperties.elevations`.

Preferred coordinate precision is 5 decimal places.

```json
[139.76713, 35.68124]
```

This is roughly meter-level precision and is compact enough for SNS usage.

## Properties

Common feature properties:

| Property | Type | Description |
| --- | --- | --- |
| `title` | string | Display title |
| `description` | string | Display description |
| `color` | string | CSS color for the route |
| `weight` | number | Leaflet polyline weight |
| `opacity` | number | Leaflet polyline opacity |
| `metadata` | object | Optional activity metadata |
| `coordinateProperties` | object | Per-coordinate sample series |

Example:

```json
{
  "title": "Ride to Kamakura",
  "description": "Sample route",
  "color": "#0078A8",
  "weight": 4,
  "opacity": 0.8
}
```

## coordinateProperties

`coordinateProperties` stores arrays aligned with `geometry.coordinates`.

Each array should have the same length as `geometry.coordinates`.

```json
{
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
```

Standard series:

| Name | Unit | Description |
| --- | --- | --- |
| `times` | seconds or milliseconds | Unix timestamp |
| `distances` | m | Distance from route start |
| `elevations` | m | Elevation |
| `heartRates` | bpm | Heart rate |
| `cadences` | rpm | Cadence |
| `powers` | W | Power |
| `speeds` | km/h | Speed |

Custom numeric series are allowed.

Reserved standard names should not be reused for custom metrics.

```text
times
distances
elevations
heartRates
cadences
powers
speeds
```

Unsafe property names should not be used.

```text
__proto__
constructor
prototype
```

## Time values

`times` may be Unix seconds or Unix milliseconds.

The viewer detects and formats both.

Generated TrackJSON should use Unix seconds unless millisecond precision is
needed.

## Speed values

`speeds` are stored in `km/h`.

FIT input often stores speed internally as `m/s`; conversion to TrackJSON changes
it to `km/h`.

## Metadata

TrackJSON metadata is stored in `Feature.properties.metadata`.

```json
{
  "metadata": {
    "source": {
      "type": "fit"
    },
    "sport": "cycling",
    "subSport": "road",
    "startTime": 1710000000,
    "totalDistanceM": 12345.7,
    "totalTimerTime": 3600,
    "totalElapsedTime": 3900,
    "device": {
      "manufacturer": "garmin",
      "product": "edge",
      "serialNumber": 123456789
    },
    "statistics": {
      "powerW": {
        "avg": 176.5,
        "median": 164,
        "max": 742
      }
    },
    "training": {
      "normalizedPowerW": 213,
      "totalWorkJ": 1285000,
      "totalCaloriesCal": 720000,
      "source": {
        "normalizedPower": "computed",
        "totalWork": "computed",
        "totalCalories": "fit"
      }
    }
  }
}
```

Common metadata fields:

| Field | Type | Description |
| --- | --- | --- |
| `source.type` | string | Source format, such as `fit` or `example` |
| `source.formatVersion` | string | Optional source format version |
| `name` | string | Activity name |
| `description` | string | Activity description |
| `sport` | string | Sport name |
| `subSport` | string | Sub-sport name |
| `createdAt` | number | Unix timestamp |
| `startTime` | number | Unix timestamp |
| `totalDistanceM` | number | Total distance in meters |
| `totalTimerTime` | number | Moving/timer time in seconds |
| `totalElapsedTime` | number | Elapsed time in seconds |
| `device.manufacturer` | string | Device manufacturer |
| `device.product` | string | Device product |
| `device.serialNumber` | number | Device serial number |
| `statistics.speedKph` | object | Speed statistics from raw speed samples in km/h |
| `statistics.cadenceRpm` | object | Cadence statistics from raw cadence samples in rpm |
| `statistics.heartRateBpm` | object | Heart-rate statistics from raw heart-rate samples in bpm |
| `statistics.powerW` | object | Power statistics from raw power samples in watts |
| `training.normalizedPowerW` | number | Normalized Power in watts, from FIT when present or computed from raw power |
| `training.totalWorkJ` | number | Total mechanical work in joules, from FIT when present or computed from raw power |
| `training.totalCaloriesCal` | number | Total calories in calories, converted from FIT totalCalories metadata when present |
| `training.source.*` | string | Source marker such as `fit` or `computed` |

Statistic objects use these fields.

| Field | Type | Description |
| --- | --- | --- |
| `avg` | number | Arithmetic average of raw samples |
| `median` | number | Median of raw samples |
| `max` | number | Maximum raw sample value |

Activity average speed is intentionally not stored separately. Consumers can
compute gross or timer/moving average later from `totalDistanceM`,
`totalElapsedTime`, and `totalTimerTime`.

TSS, IF, and FTP are intentionally not computed or emitted by the FIT converter.
If a future source format provides them explicitly, they can be added as
additional metadata fields.

Metadata is optional. The viewer ignores unknown metadata fields.

## Numeric precision

Generated or compacted TrackJSON should reduce numeric precision to keep files
small.

Default precision:

| Value | Precision |
| --- | --- |
| coordinates | 5 decimal places |
| times | integer |
| distances | 1 decimal place |
| elevations | 1 decimal place |
| heartRates | 1 decimal place |
| cadences | 1 decimal place |
| powers | 1 decimal place |
| speeds | 1 decimal place |
| custom metrics | 1 decimal place |
| metadata | 1 decimal place |
| `createdAt` / `startTime` / `timeCreated` | integer |
| `serialNumber` | integer |
| `totalElapsedTime` / `totalTimerTime` | integer |
| `training.totalWorkJ` / `training.totalCaloriesCal` | integer |
| statistics and `training.normalizedPowerW` | metadata precision |

Rounding should be applied when emitting or compacting TrackJSON, not while
performing internal calculations.

## gzip-compressed TrackJSON

A `.trjgz` file is a gzip-compressed TrackJSON file.

```sh
gzip -9 -c ride.trj > ride.trjgz
```

The browser demo can create `.trjgz` using `CompressionStream("gzip")`, but the
browser API does not expose gzip compression level. For maximum compression,
generate `.trjgz` on the server side or in a build step.

## Downsampling

TrackJSON downsampling must keep `geometry.coordinates` and
`coordinateProperties` aligned.

Two strategies are supported.

```text
uniform
aggregate
```

### uniform

`uniform` keeps selected original samples.

```text
p0 p1 p2 p3 p4 p5 p6 p7 p8 p9
↓ maxPoints = 4
p0       p3       p6       p9
```

For TrackJSON:

```text
coordinates                 selected by index
coordinateProperties.*       selected by the same index
```

This preserves original points and is safest for route geometry.

### aggregate

`aggregate` divides points into buckets and emits one representative point for
each bucket.

For each bucket:

```text
coordinates   representative middle sample
times         representative middle sample
distances     representative middle sample
elevations    average
heartRates    average
cadences      average
powers        average
speeds        average
custom series average
```

`0` is a valid value and must be included in averages.

`undefined`, `null`, and non-numeric values are ignored for averages.

If no numeric value exists in a bucket for a series, the representative sample is
kept when possible.

### preserveEndpoints

When `preserveEndpoints` is enabled:

```text
first output point  original first point
last output point   original last point
middle points       uniform or aggregate result
```

For SNS route digests, `preserveEndpoints: true` is usually the best default.

## Fill-forward

FIT to TrackJSON conversion fill-forwards these series:

```text
heartRates
cadences
powers
```

Missing values before the first valid value become `0`.

If a series has no valid value at all, it is omitted.

These series are not fill-forwarded:

```text
times
distances
elevations
speeds
custom metrics
```

Raw TrackJSON downsampling does not add fill-forward values. It processes the
series already present in the file.

## Minimal valid example

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [139.76713, 35.68124],
          [139.768, 35.682]
        ]
      },
      "properties": {
        "title": "Minimal route"
      }
    }
  ]
}
```

## Graphable example

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [139.76713, 35.68124],
          [139.768, 35.682],
          [139.769, 35.683]
        ]
      },
      "properties": {
        "title": "Graphable route",
        "color": "#0078A8",
        "coordinateProperties": {
          "times": [1710000000, 1710000030, 1710000060],
          "distances": [0, 120.5, 241.0],
          "elevations": [12.3, 15.8, 14.2],
          "heartRates": [120, 125, 129],
          "cadences": [80, 82, 79],
          "powers": [150, 180, 160],
          "speeds": [24.2, 25.1, 23.8]
        }
      }
    }
  ]
}
```

## Validation checklist

A generated TrackJSON file should satisfy:

```text
root.type is FeatureCollection
features is an array
route features use geometry.type = LineString
coordinates use [lon, lat]
coordinates has at least two points
coordinateProperties arrays match coordinates length
speeds are km/h
distances are meters
elevations are meters
times are Unix seconds or milliseconds
numeric values are compacted
unsafe metric names are not used
metadata is optional
unknown metadata fields are safe to ignore
```

## Compatibility notes

The viewer is lenient about unknown properties.

Unknown feature properties and unknown metadata fields are ignored.

Unknown numeric `coordinateProperties` series may be shown as custom graph
series when complete and aligned with the coordinate array.

Non-numeric or incomplete custom series may be ignored.


## Privacy obfuscation

TrackJSON coordinates can be privacy-obfuscated before downsampling. The clamp
algorithm replaces the longitude and latitude of the first `startDistanceM`
meters with the boundary coordinate at `startDistanceM`, and replaces the last
`endDistanceM` meters with the boundary coordinate at `totalDistanceM -
endDistanceM`.

The operation changes only coordinate longitude and latitude values. It preserves
metadata and `coordinateProperties`, including distances, times, heart rate,
cadence, power, and speed.

If `coordinateProperties.distances` is present, it is used for boundary matching.
Otherwise, cumulative coordinate distance is computed from the LineString.
