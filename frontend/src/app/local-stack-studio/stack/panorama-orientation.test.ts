import {
  panoramaCameraPathAxis,
  restoreVerticalWaveCorrectionRoll,
} from "./panorama-orientation";

function rotationX(degrees: number): Float32Array {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Float32Array([
    1, 0, 0,
    0, cosine, -sine,
    0, sine, cosine,
  ]);
}

function rotationY(degrees: number): Float32Array {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Float32Array([
    cosine, 0, sine,
    0, 1, 0,
    -sine, 0, cosine,
  ]);
}

function rotateGlobalZ90(rotation: Float32Array): Float32Array {
  return new Float32Array([
    -rotation[3]!, -rotation[4]!, -rotation[5]!,
    rotation[0]!, rotation[1]!, rotation[2]!,
    rotation[6]!, rotation[7]!, rotation[8]!,
  ]);
}

function expectRotationClose(actual: Float32Array, expected: Float32Array): void {
  expect(Array.from(actual)).toHaveLength(9);
  for (let index = 0; index < 9; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 6);
  }
}

describe("Panorama camera orientation", () => {
  test("matches OpenCV AUTO axis detection for vertical and horizontal pans", () => {
    expect(panoramaCameraPathAxis([
      rotationX(-12),
      rotationX(0),
      rotationX(12),
    ])).toBe("vertical");

    expect(panoramaCameraPathAxis([
      rotationY(-12),
      rotationY(0),
      rotationY(12),
    ])).toBe("horizontal");
  });

  test("restores upright orientation after OpenCV-style vertical quarter-turn", () => {
    const estimated = [
      rotationX(-10),
      rotationX(0),
      rotationX(10),
      rotationX(20),
    ];
    const sideways = estimated.map(rotateGlobalZ90);

    expect(panoramaCameraPathAxis(estimated)).toBe("vertical");
    expect(panoramaCameraPathAxis(sideways)).toBe("horizontal");

    const restored = restoreVerticalWaveCorrectionRoll(estimated, sideways);
    expect(panoramaCameraPathAxis(restored)).toBe("vertical");
    restored.forEach((rotation, index) => expectRotationClose(rotation, estimated[index]!));
  });

  test("does not rotate horizontal panoramas", () => {
    const estimated = [rotationY(-10), rotationY(0), rotationY(10)];
    const corrected = estimated.map((rotation) => new Float32Array(rotation));

    const restored = restoreVerticalWaveCorrectionRoll(estimated, corrected);
    restored.forEach((rotation, index) => expectRotationClose(rotation, corrected[index]!));
  });
});
