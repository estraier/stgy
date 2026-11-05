import { matchSpatialOrbDescriptors, orbCornerCorrection, scaleOrbAffine } from "./progressive-orb-matching";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("progressive ORB spatial matching", () => {
  test("1MP: permits nearby translation but never a far-away identical descriptor", () => {
    const referencePoints = [{ x: 10, y: 10 }, { x: 130, y: 140 }, { x: 40, y: 10 }];
    const targetPoints = [{ x: 13, y: 11 }, { x: 90, y: 140 }];
    const referenceDescriptors = Uint8Array.of(1, 7, 1);
    const targetDescriptors = Uint8Array.of(1, 7);
    const matches = matchSpatialOrbDescriptors({
      referencePoints, targetPoints, referenceDescriptors, targetDescriptors,
      descriptorBytes: 1, prediction: identity, maxDx: 5, maxDy: 5,
    });
    expect(matches).toEqual([{ referenceIndex: 0, targetIndex: 0, distance: 0 }]);
  });

  test("8MP: matches inside a circular radius 8 at the predicted affine position", () => {
    const prediction = [1, 0, 10, 0, 1, -3, 0, 0, 1];
    const matches = matchSpatialOrbDescriptors({
      referencePoints: [{ x: 110, y: 97 }, { x: 117, y: 104 }, { x: 200, y: 150 }],
      targetPoints: [{ x: 100, y: 100 }],
      referenceDescriptors: Uint8Array.of(0, 0, 0),
      targetDescriptors: Uint8Array.of(0),
      descriptorBytes: 1, prediction, maxDx: 8, maxDy: 8, circular: true,
    });
    expect(matches).toEqual([{ referenceIndex: 0, targetIndex: 0, distance: 0 }]);
  });

  test("one-to-one selection prevents the same reference keypoint being reused", () => {
    const matches = matchSpatialOrbDescriptors({
      referencePoints: [{ x: 10, y: 10 }], targetPoints: [{ x: 11, y: 10 }, { x: 12, y: 10 }],
      referenceDescriptors: Uint8Array.of(3), targetDescriptors: Uint8Array.of(3, 15),
      descriptorBytes: 1, prediction: identity, maxDx: 5, maxDy: 5,
    });
    expect(matches).toEqual([{ referenceIndex: 0, targetIndex: 0, distance: 0 }]);
  });

  test("1MP -> 8MP -> 1MP preserves the similarity transform", () => {
    const matrix = [1.002, -0.006, 3, 0.006, 1.002, -2, 0, 0, 1];
    const high = scaleOrbAffine(matrix, 1200, 800, 3394, 2263);
    const restored = scaleOrbAffine(high, 3394, 2263, 1200, 800);
    for (let i = 0; i < matrix.length; i += 1) {
      expect(restored[i]).toBeCloseTo(matrix[i], 12);
    }
  });

  test("corner correction rejects large rotations even when translation is unchanged", () => {
    const shifted = [1, -0.002, 0, 0.002, 1, 0, 0, 0, 1];
    expect(orbCornerCorrection(identity, shifted, 4000, 3000)).toBeGreaterThan(8);
    expect(orbCornerCorrection(identity, [1, 0, 2, 0, 1, 3, 0, 0, 1], 4000, 3000)).toBeCloseTo(Math.hypot(2, 3));
  });
});
