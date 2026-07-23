import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { GeoCoder } from "./geocoder";

const TEST_DATA = join(__dirname, "../test-data/geo-japan-test.ndjson");

describe("GeoCoder", () => {
  test("encodes an exact Japanese label and restores its hierarchy", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    expect(geoCoder.encode("埼玉県所沢市", "ja")).toEqual([
      expect.objectContaining({ level: 2, country: "JP" }),
      expect.objectContaining({ level: 1, country: "JP" }),
    ]);
    expect(geoCoder.encode("埼玉県所沢市並木", "ja")).toEqual([]);
  });

  test("decodes from representative and alias points", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    for (const coordinates of [
      [139.475001, 35.800026],
      [139.4511, 35.8124],
    ]) {
      expect(geoCoder.decode(coordinates[0], coordinates[1], "ja")[0]).toEqual(
        expect.objectContaining({
          level: 2,
          addresses: [expect.objectContaining({ label: "埼玉県所沢市" })],
        }),
      );
    }
    expect(geoCoder.decode(0, 0, "ja")).toEqual([]);
  });

  test("sorts representative and alias points by latitude after loading", () => {
    const geoCoder = new GeoCoder([TEST_DATA]) as unknown as {
      highestLevelPlaces: readonly { latitude: number }[];
      aliasLongitudes: Float32Array;
      aliasLatitudes: Float32Array;
      aliasBelongTo: Uint16Array | Uint32Array;
    };

    expect(geoCoder.aliasLongitudes).toBeInstanceOf(Float32Array);
    expect(geoCoder.aliasLatitudes).toBeInstanceOf(Float32Array);
    expect(geoCoder.aliasBelongTo).toBeInstanceOf(Uint16Array);
    expect(geoCoder.highestLevelPlaces.map((place) => place.latitude)).toEqual(
      geoCoder.highestLevelPlaces
        .map((place) => place.latitude)
        .sort((left, right) => left - right),
    );
    expect(Array.from(geoCoder.aliasLatitudes)).toEqual(
      Array.from(geoCoder.aliasLatitudes).sort((left, right) => left - right),
    );
  });

  test("accepts place and alias records in any order", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "unordered.ndjson");
    const lines = readFileSync(TEST_DATA, "utf8").trim().split("\n");
    writeFileSync(file, lines.reverse().join("\n"));

    try {
      const geoCoder = new GeoCoder([file]);
      expect(geoCoder.encode("埼玉県所沢市", "ja")[0]).toEqual(
        expect.objectContaining({ level: 2 }),
      );
      expect(geoCoder.decode(139.4511, 35.8124, "ja")[0]).toEqual(
        expect.objectContaining({
          addresses: [expect.objectContaining({ label: "埼玉県所沢市" })],
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects an alias whose place does not exist", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "bad.ndjson");
    writeFileSync(
      file,
      [
        JSON.stringify({
          id: 1,
          level: 1,
          country: "JP",
          longitude: 139,
          latitude: 35,
          addresses: [{ locale: "ja", label: "東京都", elements: ["東京都"] }],
        }),
        JSON.stringify({ longitude: 139, latitude: 35, belongTo: 999 }),
      ].join("\n"),
    );

    try {
      expect(() => new GeoCoder([file])).toThrow("unknown place id: 999");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
