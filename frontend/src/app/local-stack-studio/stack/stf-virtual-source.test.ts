import { decodeStfGeneratedStripe, findStfPairOuterFrames } from "./stf-virtual-source";
import { buildStfFrameSet } from "./stf-frame-generation";
import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";

describe("STF virtual gamma-2 RGB16 numerical domain", () => {
  test("preserves extended highlights through linear 4", () => {
    const inputs = [0, 0.125, 0.5, 1, 2.5, 4];
    const encoded = Uint16Array.from(inputs.map((linear) => encodeStoredRgb16Channel(linear, "gamma20", 4)));
    const decoded = decodeStfGeneratedStripe(encoded, 0, encoded.length);
    inputs.forEach((value, i) => expect(decoded[i]).toBeCloseTo(value, 3));
  });
  test("rejects partial or out-of-bounds stripe", () => {
    expect(() => decodeStfGeneratedStripe(new Uint16Array(2), 1, 2)).toThrow();
  });
});

test("outer frames are attached only to endpoint real pairs, not other pairs or Gate", () => {
  const real = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
  const frameSet = buildStfFrameSet(real, 4, "interpolation-extrapolation");
  expect(frameSet.middleFrames).toHaveLength(6);
  expect(findStfPairOuterFrames(frameSet, frameSet.middleFrames[0]).map((entry) => entry.variant))
    .toEqual(["ext1"]);
  expect(findStfPairOuterFrames(frameSet, frameSet.middleFrames[5]).map((entry) => entry.variant))
    .toEqual(["ext2"]);
  for (const frame of frameSet.middleFrames.slice(1, -1)) {
    expect(findStfPairOuterFrames(frameSet, frame)).toHaveLength(0);
  }
  const interpolation = buildStfFrameSet(real, 4, "interpolation");
  expect(findStfPairOuterFrames(interpolation, interpolation.middleFrames[0])).toHaveLength(0);
});
