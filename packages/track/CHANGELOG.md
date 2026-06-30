# Changelog

All notable changes to `stgy-track` are documented here.

The project does not yet have tagged releases. The entries below describe the
current development state.

## Unreleased

### Added

- Add TrackJSON support as the main route data format.
- Add preferred raw TrackJSON extension `.trj`.
- Add gzip-compressed TrackJSON extension `.trjgz`.
- Add `.trj`, `.json`, `.geojson`, and `.trjgz` loading.
- Add extension-based TrackJSON detection so `.trj` works with simple HTTP
  servers that return `application/octet-stream`.
- Add FIT parsing through `@garmin/fitsdk`.
- Add FIT to TrackJSON conversion.
- Add FIT-derived metadata output.
- Add raw `.trj` download from the FIT demo.
- Add compressed `.trjgz` download from the FIT demo.
- Add `.trj`, `.json`, `.geojson`, and `.trjgz` upload support to the FIT demo.
- Add uniform downsampling for FIT activities.
- Add aggregate downsampling for FIT activities.
- Add uniform downsampling for TrackJSON data.
- Add aggregate downsampling for TrackJSON data.
- Add `preserveEndpoints` behavior for downsampling.
- Add TrackJSON numeric compaction.
- Add output precision options for TrackJSON conversion.
- Add meter-level coordinate precision by default.
- Add graph panel for route sample data.
- Add graph X axis selection: distance, time, and sample.
- Add graph Y series selection for standard and custom numeric series.
- Add graph smoothing with centered moving averages.
- Add graph tick labels with units.
- Add horizontal Y grid lines.
- Add zero-based Y axis for standard graph series.
- Add coordinate HUD for route sample values.
- Add original/master download link via `data-download-src`.
- Add `src/trackjson.ts` for pure TrackJSON helper logic.
- Add `src/trackjson.test.ts`.
- Add examples for raw TrackJSON, compressed TrackJSON, multiple tracks, inline
  pins, and graph/HUD behavior.
- Add `README.md`, `TESTING.md`, and `TRACKJSON.md` documentation.

### Changed

- Prefer `.trj` over `.json` for raw TrackJSON downloads.
- Keep `.trjgz` for compressed TrackJSON downloads.
- Apply downsampling to TrackJSON uploads in the FIT demo, not only FIT uploads.
- Apply numeric compaction to TrackJSON uploads before re-exporting.
- Keep internal FIT activity values at original precision and round only when
  emitting TrackJSON.
- Convert FIT speed values from m/s to km/h in TrackJSON output.
- Fill-forward FIT-derived heart rate, cadence, and power series during
  TrackJSON generation.
- Keep graph smoothing display-only; it does not modify TrackJSON, HUD values,
  or route geometry.
- Use extension checks before MIME checks for TrackJSON loader compatibility.

### Fixed

- Fix unsupported downsampling strategy validation so invalid strategies throw
  even when the activity is already below `maxPoints`.
- Fix `.trj` loading from Python's `http.server`.
- Fix TrackJSON upload/re-export path so `elevations` and other numeric series
  are compacted.
- Fix tests that compared floating-point coordinates with exact equality.

### Notes

- Browser `CompressionStream("gzip")` does not expose gzip compression level.
  For maximum compression, generate `.trjgz` on the server side or in a build
  step.
- `.trjgz` loading depends on `DecompressionStream("gzip")` support in the
  browser.
