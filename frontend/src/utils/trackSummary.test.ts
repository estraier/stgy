import type { TrackMetadataSummaryLine } from "stgy-track/analysis";
import {
  getTrackElevationSummaryItems,
  getTrackJsonPropertySummaryLines,
  getTrackSandboxMetadataSummaryLines,
  orderTrackSandboxSummaryCards,
} from "./trackSummary";

describe("getTrackElevationSummaryItems", () => {
  test("returns ascent and descent metadata in display order", () => {
    expect(
      getTrackElevationSummaryItems({
        ascentM: 456.7,
        descentM: 432.1,
      }),
    ).toEqual([
      { key: "ascent", label: "Ascent", valueM: 456.7 },
      { key: "descent", label: "Descent", valueM: 432.1 },
    ]);
  });

  test("keeps zero values and omits unavailable values", () => {
    expect(getTrackElevationSummaryItems({ ascentM: 0 })).toEqual([
      { key: "ascent", label: "Ascent", valueM: 0 },
    ]);
  });
});

describe("getTrackJsonPropertySummaryLines", () => {
  test("formats overview, bbox, and poi properties", () => {
    expect(getTrackJsonPropertySummaryLines({
      bbox: [138.1, 35.2, 139.3, 36.4],
      poi: [
        { role: "start", coordinates: [138.1, 35.2], label: "埼玉県所沢市" },
        { role: "centroid", coordinates: [138.4003, 36.4059] },
      ],
      metadata: {
        startTime: 1780643064,
        totalElapsedTime: 4788,
        localTimeOffsetSeconds: 32400,
      },
    })).toEqual([
      {
        key: "local-time-offset",
        text: "local time offset: UTC+09:00",
      },
      {
        key: "time",
        text: "time range: start 2026-06-05 16:04:24, end 2026-06-05 17:24:12",
      },
      { key: "bbox", text: "bbox: [138.1,35.2,139.3,36.4]" },
      {
        key: "poi-start",
        text: "poi start: lon 138.10000, lat 35.20000, label 埼玉県所沢市",
      },
      {
        key: "poi-centroid",
        text: "poi centroid: lon 138.40030, lat 36.40590",
      },
    ]);
  });

  test("omits unavailable properties", () => {
    expect(getTrackJsonPropertySummaryLines({ type: "FeatureCollection" })).toEqual([]);
  });
});

describe("getTrackSandboxMetadataSummaryLines", () => {
  test("orders gross, net, and elevation and omits moving threshold", () => {
    const lines: TrackMetadataSummaryLine[] = [
      { key: "time", text: "time range" },
      { key: "local-time-offset", text: "local time" },
      { key: "gross", text: "gross" },
      { key: "elevation", text: "elevation" },
      { key: "net", text: "net" },
      { key: "analysis", text: "moving threshold" },
      { key: "poi-start", text: "poi start" },
      { key: "poi-end", text: "poi end" },
      { key: "bbox", text: "bbox" },
      { key: "speedKph", text: "speed" },
    ];

    expect(getTrackSandboxMetadataSummaryLines(lines)).toEqual([
      { key: "local-time-offset", text: "local time" },
      { key: "time", text: "time range" },
      { key: "gross", text: "gross" },
      { key: "net", text: "net" },
      { key: "elevation", text: "elevation" },
      { key: "bbox", text: "bbox" },
      { key: "poi-start", text: "poi start" },
      { key: "poi-end", text: "poi end" },
      { key: "speedKph", text: "speed" },
    ]);
  });
});

describe("orderTrackSandboxSummaryCards", () => {
  test("orders the leading cards and keeps average temperature last", () => {
    const cards = [
      { label: "Average speed" },
      { label: "Average temperature" },
      { label: "Average HR" },
      { label: "Total distance" },
      { label: "Context" },
      { label: "Moving time" },
      { label: "Elapsed time" },
      { label: "Average power" },
    ];

    expect(orderTrackSandboxSummaryCards(cards).map((card) => card.label)).toEqual([
      "Context",
      "Elapsed time",
      "Moving time",
      "Total distance",
      "Average speed",
      "Average HR",
      "Average power",
      "Average temperature",
    ]);
  });
});
