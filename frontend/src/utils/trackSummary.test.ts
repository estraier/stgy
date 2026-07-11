import type { TrackMetadataSummaryLine } from "stgy-track/analysis";
import {
  getTrackElevationSummaryItems,
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

describe("getTrackSandboxMetadataSummaryLines", () => {
  test("orders gross, net, and elevation and omits moving threshold", () => {
    const lines: TrackMetadataSummaryLine[] = [
      { key: "gross", text: "gross" },
      { key: "elevation", text: "elevation" },
      { key: "net", text: "net" },
      { key: "analysis", text: "moving threshold" },
      { key: "speedKph", text: "speed" },
    ];

    expect(getTrackSandboxMetadataSummaryLines(lines)).toEqual([
      { key: "gross", text: "gross" },
      { key: "net", text: "net" },
      { key: "elevation", text: "elevation" },
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
