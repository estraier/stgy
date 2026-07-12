import {
  compactTrackJsonData,
  countTrackJsonPositionedPoints,
  downsampleTrackJsonData,
  getTrackJsonMetadata,
  getTrackJsonPoi,
  getTrackJsonPointOfInterest,
  getTrackJsonTitle,
  obfuscateTrackJsonPrivacy,
  parseTrackJsonData,
} from "./trackjson";

describe("parseTrackJsonData", () => {
  test("accepts FeatureCollection and Feature roots", () => {
    expect(parseTrackJsonData(JSON.stringify(makeFeatureCollection(3)))).toMatchObject({
      type: "FeatureCollection",
    });
    expect(parseTrackJsonData(JSON.stringify(makeFeature(3)))).toMatchObject({
      type: "Feature",
    });
  });

  test("rejects invalid JSON and unsupported roots", () => {
    expect(() => parseTrackJsonData("{")).toThrow("could not be parsed");
    expect(() => parseTrackJsonData("[]")).toThrow("root must be an object");
    expect(() => parseTrackJsonData("{}")).toThrow(
      "must be a GeoJSON FeatureCollection or Feature"
    );
  });
});

describe("TrackJSON metadata and summaries", () => {
  test("counts positioned points in FeatureCollection and MultiLineString", () => {
    const data = makeFeatureCollection(3);
    data.features.push({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[139, 35], [139.1, 35.1]],
          [[139.2, 35.2]],
        ],
      },
      properties: {},
    });

    expect(countTrackJsonPositionedPoints(data)).toBe(6);
  });

  test("extracts title and metadata from the first feature", () => {
    const data = makeFeatureCollection(3);

    expect(getTrackJsonTitle(data)).toBe("Sample Track");
    expect(getTrackJsonMetadata(data)).toEqual({
      sport: "cycling",
      totalDistanceM: 12345.678,
    });
  });

  test("reads valid point-of-interest entries by role", () => {
    const data = {
      ...makeFeatureCollection(3),
      poi: [
        { role: "start", coordinates: [139, 35] },
        { role: "centroid", coordinates: [139.1, 35.1] },
        { role: "invalid", coordinates: [0, 0] },
        { role: "end", coordinates: ["bad", 35] },
      ],
    };

    expect(getTrackJsonPoi(data)).toEqual([
      { role: "start", coordinates: [139, 35] },
      { role: "centroid", coordinates: [139.1, 35.1] },
    ]);
    expect(getTrackJsonPointOfInterest(data, "centroid")).toEqual({
      role: "centroid",
      coordinates: [139.1, 35.1],
    });
    expect(getTrackJsonPointOfInterest(data, "furthest")).toBeUndefined();
  });

  test("prefers root metadata when available", () => {
    const data = {
      ...makeFeatureCollection(3),
      metadata: {
        source: "root",
      },
    };

    expect(getTrackJsonMetadata(data)).toEqual({ source: "root" });
  });
});

describe("downsampleTrackJsonData", () => {
  test("uniform downsampling keeps coordinates and coordinateProperties in sync", () => {
    const data = makeFeatureCollection(10);
    const downsampled = downsampleTrackJsonData(data, {
      maxPoints: 4,
      strategy: "uniform",
      preserveEndpoints: true,
    }) as any;
    const feature = downsampled.features[0];

    expectCoordinatesToBeClose(feature.geometry.coordinates, [
      [139.00000123, 35.00000123],
      [139.00003123, 35.00003123],
      [139.00006123, 35.00006123],
      [139.00009123, 35.00009123],
    ]);
    expect(feature.properties.coordinateProperties.times).toEqual([1000, 1003, 1006, 1009]);
    expect(feature.properties.coordinateProperties.altitudes).toEqual([
      100.123,
      103.123,
      106.123,
      109.123,
    ]);
  });

  test("aggregate downsampling averages measured series", () => {
    const data = makeFeatureCollection(10);
    const downsampled = downsampleTrackJsonData(data, {
      maxPoints: 4,
      strategy: "aggregate",
      preserveEndpoints: true,
    }) as any;
    const feature = downsampled.features[0];

    expectCoordinatesToBeClose(feature.geometry.coordinates, [
      [139.00000123, 35.00000123],
      [139.00002123, 35.00002123],
      [139.00006123, 35.00006123],
      [139.00009123, 35.00009123],
    ]);
    expect(feature.properties.coordinateProperties.times).toEqual([1000, 1002, 1006, 1009]);
    expect(feature.properties.coordinateProperties.distances).toEqual([0, 20, 60, 90]);
    expect(feature.properties.coordinateProperties.altitudes).toEqual([
      100.123,
      102.623,
      106.623,
      109.123,
    ]);
    expect(feature.properties.coordinateProperties.powers).toEqual([
      150,
      152.5,
      156.5,
      159,
    ]);
    expect(feature.properties.coordinateProperties.speeds).toEqual([
      18,
      18.9,
      20.34,
      21.24,
    ]);
    expect(feature.properties.coordinateProperties.grade).toEqual([
      1,
      3.5,
      7.5,
      10,
    ]);
  });

  test("aggregate downsampling treats zero as a valid value", () => {
    const data = makeFeatureCollection(4);
    const feature = data.features[0] as any;
    feature.properties.coordinateProperties.powers = [0, 100, 0, 200];

    const downsampled = downsampleTrackJsonData(data, {
      maxPoints: 2,
      strategy: "aggregate",
      preserveEndpoints: false,
    }) as any;

    expect(
      downsampled.features[0].properties.coordinateProperties.powers
    ).toEqual([50, 100]);
  });

  test("rejects unsupported strategy and invalid maxPoints", () => {
    const data = makeFeatureCollection(3);

    expect(() => downsampleTrackJsonData(data, {
      maxPoints: 3,
      strategy: "distance" as any,
    })).toThrow(RangeError);

    expect(() => downsampleTrackJsonData(data, {
      maxPoints: 1,
    })).toThrow(RangeError);
  });
});


describe("obfuscateTrackJsonPrivacy", () => {
  test("clamps start and end coordinates using distance series", () => {
    const data = makeFeatureCollection(6);
    const obfuscated = obfuscateTrackJsonPrivacy(data, {
      startDistanceM: 20,
      endDistanceM: 20,
    }) as any;
    const coordinates = obfuscated.features[0].geometry.coordinates;

    expectCoordinatesToBeClose(coordinates.slice(0, 3), [
      [139.00002123, 35.00002123],
      [139.00002123, 35.00002123],
      [139.00002123, 35.00002123],
    ]);
    expectCoordinatesToBeClose(coordinates.slice(3), [
      [139.00003123, 35.00003123],
      [139.00003123, 35.00003123],
      [139.00003123, 35.00003123],
    ]);
    expect(obfuscated.features[0].properties.coordinateProperties.distances).toEqual([
      0,
      10,
      20,
      30,
      40,
      50,
    ]);
  });

  test("does not mutate the input TrackJSON", () => {
    const data = makeFeatureCollection(4);
    const before = JSON.stringify(data);

    obfuscateTrackJsonPrivacy(data, { startDistanceM: 10 });

    expect(JSON.stringify(data)).toBe(before);
  });

  test("uses coordinate distance fallback when distances are missing", () => {
    const data = makeFeatureCollection(4);
    delete (data.features[0] as any).properties.coordinateProperties.distances;

    const obfuscated = obfuscateTrackJsonPrivacy(data, {
      startDistanceM: 1,
    }) as any;
    const coordinates = obfuscated.features[0].geometry.coordinates;

    expectCoordinatesToBeClose(coordinates.slice(0, 2), [
      [139.00001123, 35.00001123],
      [139.00001123, 35.00001123],
    ]);
  });

  test("rejects negative privacy distances", () => {
    expect(() => obfuscateTrackJsonPrivacy(makeFeatureCollection(3), {
      startDistanceM: -1,
    })).toThrow(RangeError);
  });
});

describe("compactTrackJsonData", () => {
  test("rounds coordinates, coordinateProperties, and metadata", () => {
    const compacted = compactTrackJsonData(makeFeatureCollection(3)) as any;
    const feature = compacted.features[0];

    expect(feature.geometry.coordinates).toEqual([
      [139, 35],
      [139.00001, 35.00001],
      [139.00002, 35.00002],
    ]);
    expect(feature.properties.coordinateProperties.times).toEqual([1000, 1001, 1002]);
    expect(feature.properties.coordinateProperties.distances).toEqual([0, 10, 20]);
    expect(feature.properties.coordinateProperties.altitudes).toEqual([
      100.1,
      101.1,
      102.1,
    ]);
    expect(feature.properties.coordinateProperties.speeds).toEqual([18, 18.4, 18.7]);
    expect(feature.properties.coordinateProperties.grade).toEqual([1, 2, 3]);
    expect(feature.properties.metadata.totalDistanceM).toBe(12345.7);
  });

  test("supports precision overrides", () => {
    const compacted = compactTrackJsonData(makeFeatureCollection(2), {
      coordinates: 6,
      speeds: 2,
      metadata: 0,
    }) as any;
    const feature = compacted.features[0];

    expect(feature.geometry.coordinates[1]).toEqual([139.000011, 35.000011]);
    expect(feature.properties.coordinateProperties.speeds).toEqual([18, 18.36]);
    expect(feature.properties.metadata.totalDistanceM).toBe(12346);
  });

  test("rounds top-level bbox and poi coordinates", () => {
    const compacted = compactTrackJsonData({
      ...makeFeatureCollection(2),
      bbox: [139.00000123, 35.00000123, 139.00001123, 35.00001123],
      poi: [
        {
          role: "centroid",
          coordinates: [139.00000623, 35.00000623],
        },
      ],
    }) as any;

    expect(compacted.bbox).toEqual([139, 35, 139.00001, 35.00001]);
    expect(compacted.poi).toEqual([
      { role: "centroid", coordinates: [139.00001, 35.00001] },
    ]);
  });

  test("rounds point coordinates with coordinate precision", () => {
    const compacted = compactTrackJsonData({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [138.330295, 36.35955, 541.234],
      },
      properties: {
        title: "Pin",
      },
    }) as any;

    expect(compacted.geometry.coordinates).toEqual([138.3303, 36.35955, 541.2]);
  });
});


function expectCoordinatesToBeClose(
  actual: unknown,
  expected: number[][]
) {
  expect(Array.isArray(actual)).toBe(true);
  const coordinates = actual as unknown[];
  expect(coordinates).toHaveLength(expected.length);

  expected.forEach((expectedCoordinate, coordinateIndex) => {
    const actualCoordinate = coordinates[coordinateIndex];
    expect(Array.isArray(actualCoordinate)).toBe(true);
    const actualValues = actualCoordinate as unknown[];
    expect(actualValues).toHaveLength(expectedCoordinate.length);

    expectedCoordinate.forEach((expectedValue, valueIndex) => {
      expect(actualValues[valueIndex]).toBeCloseTo(expectedValue, 8);
    });
  });
}

function makeFeatureCollection(pointCount: number): any {
  return {
    type: "FeatureCollection",
    features: [makeFeature(pointCount)],
  };
}

function makeFeature(pointCount: number): any {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: Array.from({ length: pointCount }, (_, index) => {
        return [
          139 + index * 0.00001 + 0.00000123,
          35 + index * 0.00001 + 0.00000123,
        ];
      }),
    },
    properties: {
      title: " Sample Track ",
      metadata: {
        sport: "cycling",
        totalDistanceM: 12345.678,
      },
      coordinateProperties: {
        times: Array.from({ length: pointCount }, (_, index) => 1000 + index),
        distances: Array.from({ length: pointCount }, (_, index) => index * 10),
        altitudes: Array.from({ length: pointCount }, (_, index) => 100.123 + index),
        heartRates: Array.from({ length: pointCount }, (_, index) => 120 + index),
        cadences: Array.from({ length: pointCount }, (_, index) => 80 + index),
        powers: Array.from({ length: pointCount }, (_, index) => 150 + index),
        speeds: Array.from({ length: pointCount }, (_, index) => 18 + index * 0.36),
        grade: Array.from({ length: pointCount }, (_, index) => 1 + index),
      },
    },
  };
}