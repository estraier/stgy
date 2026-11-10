import {
  cropGamma2RgbCounterClockwise,
  rotateGamma2RgbCounterClockwiseInPlace,
  selectPanoramaProjection,
  selectPanoramaGeometry,
  turnCameraForVerticalCylindrical,
} from "./panorama-projection";
import { checkPanoramaCameraGeometry } from "./panorama-orientation";

function rotationX(degrees: number): Float32Array {
  const theta = degrees * Math.PI / 180;
  return new Float32Array([1, 0, 0, 0, Math.cos(theta), -Math.sin(theta), 0, Math.sin(theta), Math.cos(theta)]);
}
function rotationZ(degrees: number): Float32Array {
  const theta = degrees * Math.PI / 180;
  return new Float32Array([Math.cos(theta), -Math.sin(theta), 0, Math.sin(theta), Math.cos(theta), 0, 0, 0, 1]);
}
function rotationY(degrees: number): Float32Array {
  const theta = degrees * Math.PI / 180;
  return new Float32Array([Math.cos(theta), 0, Math.sin(theta), 0, 1, 0, -Math.sin(theta), 0, Math.cos(theta)]);
}
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const result = new Float32Array(9);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1)
    for (let k = 0; k < 3; k += 1) result[i * 3 + j] += a[i * 3 + k]! * b[k * 3 + j]!;
  return result;
}

const principal = [rotationY(-20), rotationY(0), rotationY(20)];
const vertical = [rotationX(-20), rotationX(0), rotationX(20)];

describe("Panorama alignment projection", () => {
  test("explicit modes control projection without analyzing camera orientation", () => {
    expect(selectPanoramaProjection("spherical", principal)).toBe("spherical");
    expect(selectPanoramaProjection("horizontal", vertical)).toBe("cylindrical-horizontal");
    expect(selectPanoramaProjection("vertical", principal)).toBe("cylindrical-vertical");
  });
  test("Auto picks horizontal or vertical from optical axes, not image aspect ratios", () => {
    expect(selectPanoramaProjection("auto", principal)).toBe("cylindrical-horizontal");
    expect(selectPanoramaProjection("auto", vertical)).toBe("cylindrical-vertical");
  });
  test("Auto retains Spherical for grids, diagonal movement and near-identical inputs", () => {
    expect(selectPanoramaProjection("auto", [
      multiply(rotationX(-20), rotationY(-20)), multiply(rotationX(-20), rotationY(20)),
      multiply(rotationX(20), rotationY(-20)), multiply(rotationX(20), rotationY(20)),
    ])).toBe("spherical");
    expect(selectPanoramaProjection("auto", [rotationX(0), multiply(rotationX(12), rotationY(12))])).toBe("spherical");
    expect(selectPanoramaProjection("auto", [rotationY(0), rotationY(0.5)])).toBe("spherical");
  });
  test("Auto assigns geometry constraints from the same projection used for output", () => {
    expect(selectPanoramaGeometry("auto", principal)).toEqual({
      projection: "cylindrical-horizontal", constraintDirection: "horizontal",
    });
    expect(selectPanoramaGeometry("auto", vertical)).toEqual({
      projection: "cylindrical-vertical", constraintDirection: "vertical",
    });
    const grid = [
      multiply(rotationX(-20), rotationY(-20)), multiply(rotationX(-20), rotationY(20)),
      multiply(rotationX(20), rotationY(-20)), multiply(rotationX(20), rotationY(20)),
    ];
    expect(selectPanoramaGeometry("auto", grid)).toEqual({
      projection: "spherical", constraintDirection: null,
    });
    expect(selectPanoramaGeometry("spherical", principal)).toEqual({
      projection: "spherical", constraintDirection: null,
    });
    expect(selectPanoramaGeometry("horizontal", vertical)).toEqual({
      projection: "cylindrical-horizontal", constraintDirection: "horizontal",
    });
    expect(selectPanoramaGeometry("vertical", principal)).toEqual({
      projection: "cylindrical-vertical", constraintDirection: "vertical",
    });
  });

  test("Auto-recommended cylinders validate direction, roll and focal length", () => {
    const sizes = [{width: 1600, height: 1000}, {width: 1600, height: 1000}, {width: 1600, height: 1000}];
    const toCameras = (rotations: Float32Array[], focals: number[]) => rotations.map((rotation, index) => ({
      rotation, focal: focals[index]!, aspect: 1,
    }));
    const horizontalRotations = [rotationY(0), rotationY(15), rotationY(30)];
    const horizontalSelection = selectPanoramaGeometry("auto", horizontalRotations);
    expect(horizontalSelection.constraintDirection).toBe("horizontal");
    const validHorizontal = checkPanoramaCameraGeometry(horizontalSelection.constraintDirection!,
      toCameras(horizontalRotations, [1000, 1000, 1000]), sizes, 1)!;
    expect(validHorizontal.accepted).toBe(true);
    const focalOutlier = checkPanoramaCameraGeometry(horizontalSelection.constraintDirection!,
      toCameras(horizontalRotations, [1000, 1000, 1100]), sizes, 1)!;
    expect(focalOutlier.accepted).toBe(false);
    expect(focalOutlier.reason).toMatch(/focal length/);

    const shortMove = [rotationY(0), rotationY(2), rotationY(25)];
    const shortSelection = selectPanoramaGeometry("auto", shortMove);
    expect(shortSelection.constraintDirection).toBe("horizontal");
    const primaryOutlier = checkPanoramaCameraGeometry(shortSelection.constraintDirection!,
      toCameras(shortMove, [1000, 1000, 1000]), sizes, 1)!;
    expect(primaryOutlier.accepted).toBe(false);
    expect(primaryOutlier.reason).toMatch(/minimum 5%/);

    const crossMove = [rotationY(0), multiply(rotationX(7), rotationY(22))];
    const crossSelection = selectPanoramaGeometry("auto", crossMove);
    expect(crossSelection.constraintDirection).toBe("horizontal");
    const crossOutlier = checkPanoramaCameraGeometry(crossSelection.constraintDirection!,
      toCameras(crossMove, [1000, 1000]), sizes.slice(0, 2), 1)!;
    expect(crossOutlier.accepted).toBe(false);
    expect(crossOutlier.reason).toMatch(/maximum 25%/);

    const verticalSelection = selectPanoramaGeometry("auto", vertical);
    expect(verticalSelection.constraintDirection).toBe("vertical");
    const verticalRoll = [rotationX(-20), multiply(rotationX(0), rotationZ(35)), rotationX(20)];
    expect(selectPanoramaGeometry("auto", verticalRoll).constraintDirection).toBe("vertical");
    const validVertical = checkPanoramaCameraGeometry(verticalSelection.constraintDirection!,
      toCameras(vertical, [1000, 1000, 1000]), sizes, 1)!;
    expect(validVertical.accepted).toBe(true);
    const rollOutlier = checkPanoramaCameraGeometry(verticalSelection.constraintDirection!,
      toCameras(verticalRoll, [1000, 1000, 1000]), sizes, 1)!;
    expect(rollOutlier.accepted).toBe(false);
    expect(rollOutlier.reason).toMatch(/relative roll/);

    const diagonal = [rotationX(0), multiply(rotationX(12), rotationY(12))];
    const selection = selectPanoramaGeometry("auto", diagonal);
    expect(selection.constraintDirection).toBeNull();
  });

  test("handles the longitude wrap correctly", () => {
    expect(selectPanoramaProjection("auto", [rotationY(169),rotationY(179),rotationY(-171)])).toBe("cylindrical-horizontal");
  });
  test("rotating world basis turns vertical optical-axis motion into horizontal", () => {
    const rotated = vertical.map(turnCameraForVerticalCylindrical);
    expect(selectPanoramaProjection("auto", rotated)).toBe("cylindrical-horizontal");
    const identity = turnCameraForVerticalCylindrical(rotationX(0));
    expect(Array.from(identity).map((value) => value === 0 ? 0 : value)).toEqual([0,-1,0,1,0,0,0,0,1]);
  });
});

describe("Vertical cylinder output quarter-turn", () => {
  function rgbOf(...indices: number[]): Uint16Array {
    return new Uint16Array(indices.flatMap((value) => [value, value + 100, value + 1000]));
  }
  test("turns a 3x2 canvas counter-clockwise in-place, keeping RGB triplets", () => {
    // Original row 1,2,3 / row 4,5,6 -> CCW rows 3,6 / 2,5 / 1,4.
    const rgb = rgbOf(1, 2, 3, 4, 5, 6);
    rotateGamma2RgbCounterClockwiseInPlace(rgb, 3, 2);
    expect(rgb).toEqual(rgbOf(3, 6, 2, 5, 1, 4));
  });
  test("handles square and degenerate canvases", () => {
    const square = rgbOf(1, 2, 3, 4);
    rotateGamma2RgbCounterClockwiseInPlace(square, 2, 2);
    expect(square).toEqual(rgbOf(2, 4, 1, 3));
    const column = rgbOf(1, 2, 3);
    rotateGamma2RgbCounterClockwiseInPlace(column, 1, 3);
    expect(column).toEqual(rgbOf(1, 2, 3));
  });
  test("cropping and turning uses a single output allocation", () => {
    const image = rgbOf(1,2,3,4,5,6,7,8,9,10,11,12);
    // 4x3, crop columns 1..2, rows 0..2 = 2,3 / 6,7 / 10,11
    const result = cropGamma2RgbCounterClockwise(image, 4, {x:1,y:0,width:2,height:3});
    expect(result).toEqual(rgbOf(3,7,11,2,6,10));
  });
  test("in-place rotation is identical to crop plus turn for various dimensions", () => {
    for (const width of [1,2,3,4,9]) for (const height of [1,2,4,5]) {
      const original = rgbOf(...Array.from({length:width*height},(_,i)=>i+1));
      const copy = new Uint16Array(original);
      rotateGamma2RgbCounterClockwiseInPlace(copy, width,height);
      expect(copy).toEqual(cropGamma2RgbCounterClockwise(original, width, {x:0,y:0,width,height}));
    }
  });
});
