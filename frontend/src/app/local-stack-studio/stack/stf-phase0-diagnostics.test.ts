import { fingerprintStfOutputSampled, formatStfPhase0Report, StfPhase0Diagnostics } from "./stf-phase0-diagnostics";
import { buildStfApertureWeights } from "./stf-weights";
import { chooseAlignmentReferenceIndex } from "./alignment-reference";
import { buildStfToneMatchLut, transformStfToneIntensity } from "./stf-tone-match";

describe("STF Phase 0 reference invariants (before Frame generation)", () => {
  test("pins the 2x2 gamma2 output fingerprint without copying its pixels", () => {
    const pixels = new Uint16Array([0, 65535, 12345, 40000, 12000, 1, 4, 8, 16, 444, 888, 222]);
    expect(fingerprintStfOutputSampled(pixels, 2, 2)).toEqual({
      hash: "d467752c", sampledPixels: 4, totalPixels: 4,
    });
    expect(pixels).toEqual(new Uint16Array([0, 65535, 12345, 40000, 12000, 1, 4, 8, 16, 444, 888, 222]));
    expect(() => fingerprintStfOutputSampled(pixels, 2, 3)).toThrow();
  });

  test("baseline telemetry neither mutates buffers nor changes cache policies", () => {
    const diag = new StfPhase0Diagnostics(3);
    diag.cache("Gate Ratio", "hit", "RAM", 8 * 1048576);
    diag.stage("Gate-only finalize", 5.4);
    diag.workers("STF Additional Blur", 4);
    const record = diag.record(42.9, "completed");
    expect(record.version).toBe("stf-phase0-v1");
    expect(record.runId).toBe(3);
    expect(record.caches).toEqual([{
      item: "Gate Ratio", state: "hit", location: "RAM", sizeMiB: 8,
    }]);
    expect(record.stages).toEqual([{ stage: "Gate-only finalize", wallMs: 5.4 }]);
    expect(record.workers).toEqual({ "STF Additional Blur": 4 });
    expect(record.totalWallMs).toBe(42.9);
  });

  test("prints one uncollapsed, self-contained text log with run settings and details", () => {
    const diag = new StfPhase0Diagnostics(7);
    diag.setContext({
      inputCount: 7, width: 5184, height: 3888, blendWeight: 8,
      blurStrength: "medium", blurRatio: 50, blurGuard: "medium",
      blurSigmoid: 75, alignmentMode: "feature-match-orb", referenceIndex: 6,
      fNumbers: [2, 2.2, 2.5, 2.8, 3.2, 3.5, 4],
      weights: [0.2, 0.2, 0.16, 0.13, 0.12, 0.1, 0.09],
      gains: [1, 1, 1, 1, 1, 1, 1], scaledLogs: [0, 0, 0, 0, 0, 0, 0],
    });
    diag.stage("Sobel analysis", 12345.6);
    diag.cache("Gate Ratio", "hit", "RAM", 80 * 1048576);
    diag.workers("STF Additional Blur", 4);
    const record = diag.record(15555.51, "completed", [
      { label: "Merge and result generation", durationMs: 14000 },
      { label: "STF source remerge", durationMs: 1700, includedIn: "Merge" },
    ]);
    const report = formatStfPhase0Report(record);
    expect(report).toContain("run=7 | completed | total=15555.5 ms");
    expect(report).toContain("W=8 | blur=medium");
    expect(report).toContain("Sobel analysis: 12345.6 ms");
    expect(report).toContain("STF source remerge: 1700.0 ms | Included in Merge");
    expect(report).toContain("Gate Ratio: hit | RAM | 80 MiB");
    expect(report).toContain("STF Additional Blur: 4");
    const fullJson = report.split("\n").find((line) => line.startsWith("Full record JSON: "));
    expect(fullJson).toBeDefined();
    expect(JSON.parse(fullJson!.slice("Full record JSON: ".length))).toEqual(record);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const group = jest.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const table = jest.spyOn(console, "table").mockImplementation(() => {});
    try {
      diag.print(15555.51, "completed");
      expect(log).toHaveBeenCalledTimes(1);
      expect(typeof log.mock.calls[0][0]).toBe("string");
      expect(group).not.toHaveBeenCalled();
      expect(table).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      group.mockRestore();
      table.mockRestore();
    }
  });

  test("pins W=4 7-shot real-frame weights and minimal-F-number reference", () => {
    const fNumbers = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const weights = buildStfApertureWeights(fNumbers, 4);
    expect(weights).not.toBeNull();
    const expected = [
      0.21572685086771282, 0.21572685086771282, 0.1712225150025971,
      0.13589940021788177, 0.10786342543385624, 0.08561125750129871,
      0.06794970010894069,
    ];
    for (let i = 0; i < expected.length; i++) expect(weights?.[i]).toBeCloseTo(expected[i], 12);
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 2.8 }, { fNumber: 4 }, { fNumber: 2 }, { fNumber: 2.24 },
    ], "stf")).toBe(2);
  });

  test("STF tone LUT preserves extended linear range through 4 without clipping", () => {
    const lut = buildStfToneMatchLut(1, 0);
    expect(lut.gammaRangeMax).toBe(4);
    expect(lut.values[2048]).toBe(1);
    expect(lut.values[4096]).toBe(4);
    expect(transformStfToneIntensity(2.5, 1, 0)).toBe(2.5);
  });
});
