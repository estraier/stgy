import {
  panoramaCameraPathAxis,
  restoreVerticalWaveCorrectionRoll,
  checkPanoramaDirection,
  panoramaWaveCorrectionKind,
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

function yawPitch(yaw: number, pitch: number): Float32Array {
  const yawRotation = rotationY(yaw);
  const pitchRotation = rotationX(pitch);
  const result = new Float32Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) {
        result[row * 3 + col] += pitchRotation[row * 3 + k]! * yawRotation[k * 3 + col]!;
      }
    }
  }
  return result;
}

function expectRotationClose(actual: Float32Array, expected: Float32Array): void {
  expect(Array.from(actual)).toHaveLength(9);
  for (let index = 0; index < 9; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 6);
  }
}

describe("Panorama OpenCV wave correction selection", () => {
  test("maps Auto, Horizontal and Vertical to their respective native enum values", () => {
    const nativeKinds = { auto: 2, horizontal: 0, vertical: 1 };
    expect(panoramaWaveCorrectionKind("auto", nativeKinds)).toBe(2);
    expect(panoramaWaveCorrectionKind("horizontal", nativeKinds)).toBe(0);
    expect(panoramaWaveCorrectionKind("vertical", nativeKinds)).toBe(1);
  });

  test("rejects missing native constants rather than silently selecting Auto", () => {
    expect(() => panoramaWaveCorrectionKind("vertical", {
      auto: 2, horizontal: 0, vertical: Number.NaN,
    })).toThrow(/unavailable/);
  });
});

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

  test("explicit Vertical restores image-up orientation even when automatic axis detection differs", () => {
    const estimated = [rotationY(-10), rotationY(0), rotationY(10)];
    const sideways = estimated.map(rotateGlobalZ90);
    expect(panoramaCameraPathAxis(estimated)).toBe("horizontal");

    const restored = restoreVerticalWaveCorrectionRoll(estimated, sideways, "vertical");
    restored.forEach((rotation, index) => expectRotationClose(rotation, estimated[index]!));
  });

  test("explicit Horizontal does not apply a vertical quarter-turn", () => {
    const estimated = [rotationX(-10), rotationX(0), rotationX(10)];
    const corrected = estimated.map(rotateGlobalZ90);
    const restored = restoreVerticalWaveCorrectionRoll(estimated, corrected, "horizontal");
    restored.forEach((rotation, index) => expectRotationClose(rotation, corrected[index]!));
  });

  test("does not rotate horizontal panoramas", () => {
    const estimated = [rotationY(-10), rotationY(0), rotationY(10)];
    const corrected = estimated.map((rotation) => new Float32Array(rotation));

    const restored = restoreVerticalWaveCorrectionRoll(estimated, corrected);
    restored.forEach((rotation, index) => expectRotationClose(rotation, corrected[index]!));
  });
});

// These are upright, decoded image dimensions, not the dimensions in the
// original encoded file before its EXIF Orientation was applied.
const portraitImage = { width: 1000, height: 1600 };
const landscapeImage = { width: 1600, height: 1000 };
const camera = (rotation: Float32Array) => ({ rotation, focal: 1000, aspect: 1 });

describe("Panorama explicit alignment direction", () => {
  test("preserves Auto with no direction requirements", () => {
    expect(checkPanoramaDirection("auto", [], [], 1)).toEqual({ accepted: true });
  });

  test("allows portrait images joined horizontally (even in reverse input order)", () => {
    const rotations = [rotationY(22), rotationY(11), rotationY(0)];
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      rotations.map(() => portraitImage), 1)).toEqual({ accepted: true });
    expect(checkPanoramaDirection("vertical", rotations.map(camera),
      rotations.map(() => portraitImage), 1).accepted).toBe(false);
  });

  test("allows landscape images joined vertically", () => {
    const rotations = [rotationX(-25), rotationX(-13), rotationX(0)];
    expect(checkPanoramaDirection("vertical", rotations.map(camera),
      rotations.map(() => landscapeImage), 1)).toEqual({ accepted: true });
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      rotations.map(() => landscapeImage), 1).accepted).toBe(false);
  });

  test("rejects less than 5 percent primary-axis movement for any adjacent pair", () => {
    const rotations = [rotationY(0), rotationY(2), rotationY(20)];
    const result = checkPanoramaDirection("horizontal", rotations.map(camera),
      rotations.map(() => portraitImage), 1);
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toContain("images 1 and 2");
      expect(result.reason).toContain("minimum 5%");
    }
  });

  test("accepts an 8.9 percent horizontal displacement that exceeded the new 5 percent minimum", () => {
    const rotations = [rotationY(0), rotationY(5.1)];
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      [portraitImage, portraitImage], 1)).toEqual({ accepted: true });
  });

  test("accepts an 8.9 percent vertical displacement with landscape images", () => {
    const rotations = [rotationX(0), rotationX(5.1)];
    expect(checkPanoramaDirection("vertical", rotations.map(camera),
      [landscapeImage, landscapeImage], 1)).toEqual({ accepted: true });
  });

  test("rejects cross-axis movement greater than 25 percent", () => {
    const first = camera(rotationY(0));
    const second = camera(yawPitch(20, 8));
    const result = checkPanoramaDirection("horizontal", [first, second],
      [portraitImage, portraitImage], 1);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toContain("maximum 25%");
  });

  test("does not reject small permissible tilt", () => {
    const secondRotation = yawPitch(20, 3);
    expect(checkPanoramaDirection("horizontal", [camera(rotationY(0)), camera(secondRotation)],
      [portraitImage, portraitImage], 1)).toEqual({ accepted: true });
  });

  test("uses both images' upright sizes and work-scaled focal lengths", () => {
    const rotations = [rotationY(0), rotationY(4)];
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      [portraitImage, portraitImage], 1)).toEqual({ accepted: true });
    // A 4-degree displacement is less than 5% of a 1600px image at f=1000.
    const result = checkPanoramaDirection("horizontal", rotations.map(camera),
      [portraitImage, landscapeImage], 1);
    expect(result.accepted).toBe(false);
    // 50% registration scale gives f=500 as well, so the threshold is unchanged.
    expect(checkPanoramaDirection("horizontal", rotations.map((rotation) => ({
      rotation,
      focal: 500,
      aspect: 1,
    })), [portraitImage, portraitImage], 0.5)).toEqual({ accepted: true });
  });

  test("checks adjacent positions rather than relying on input file order", () => {
    const rotations = [rotationY(24), rotationY(0), rotationY(12)];
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      rotations.map(() => portraitImage), 1)).toEqual({ accepted: true });
  });

  test("handles a horizontal pan across the +/-180 degree longitude wrap", () => {
    const rotations = [rotationY(170), rotationY(-179), rotationY(-168)];
    expect(checkPanoramaDirection("horizontal", rotations.map(camera),
      rotations.map(() => portraitImage), 1)).toEqual({ accepted: true });
  });

  test("rejects invalid camera data instead of hiding it behind Auto fallback", () => {
    expect(() => checkPanoramaDirection("horizontal", [camera(rotationY(0))],
      [portraitImage], 1)).toThrow(/matching cameras/);
  });
});
