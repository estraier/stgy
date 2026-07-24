import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { GeoCoder } from "./geocoder";

const TEST_DATA = join(__dirname, "../test-data/geo-japan-test.ndjson");

describe("GeoCoder", () => {
  test("encodes exact Japanese labels and aliases", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);
    const expectedHierarchy = [
      expect.objectContaining({ level: 2, kind: "municipality", country: "JP" }),
      expect.objectContaining({ level: 1, kind: "prefecture", country: "JP" }),
    ];

    expect(geoCoder.encode("埼玉県所沢市", "ja")).toEqual(expectedHierarchy);
    expect(geoCoder.encode("所沢市", "ja")).toEqual(expectedHierarchy);
    expect(geoCoder.encode("所沢", "ja")).toEqual(expectedHierarchy);
    expect(geoCoder.encode("埼玉", "ja")).toEqual([
      expect.objectContaining({ level: 1, kind: "prefecture", country: "JP" }),
    ]);
    expect(geoCoder.encode("埼玉県所沢市並木", "ja")).toEqual([]);
  });

  test("encodes and decodes designated-city wards with their parent city", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    expect(
      geoCoder
        .encode("鶴見", "ja")
        .map((place) => ({
          label: place.addresses[0]?.label,
          level: place.level,
          kind: place.kind,
        })),
    ).toEqual([
      {
        label: "神奈川県横浜市鶴見区",
        level: 3,
        kind: "designated-city-ward",
      },
      { label: "神奈川県横浜市", level: 2, kind: "municipality" },
      { label: "神奈川県", level: 1, kind: "prefecture" },
    ]);

    expect(geoCoder.decode(139.68, 35.55, "ja")[0]).toEqual(
      expect.objectContaining({
        level: 3,
        kind: "designated-city-ward",
        addresses: [expect.objectContaining({ label: "神奈川県横浜市鶴見区" })],
      }),
    );
  });

  test("returns every place matching a shared alias", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "ambiguous.ndjson");
    writeFileSync(
      file,
      [
        {
          id: 13,
          level: 1,
          kind: "prefecture",
          country: "JP",
          longitude: 139.7,
          latitude: 35.6,
          addresses: [
            {
              locale: "ja",
              label: "東京都",
              elements: ["東京都"],
              aliases: ["東京"],
            },
          ],
        },
        {
          id: 13101,
          level: 2,
          kind: "municipality",
          country: "JP",
          longitude: 139.75,
          latitude: 35.68,
          addresses: [
            {
              locale: "ja",
              label: "東京都中央市",
              elements: ["東京都", "中央市"],
              aliases: ["中央", "中央市"],
            },
          ],
        },
        {
          id: 13102,
          level: 2,
          kind: "special-ward",
          country: "JP",
          longitude: 139.76,
          latitude: 35.67,
          addresses: [
            {
              locale: "ja",
              label: "東京都中央区",
              elements: ["東京都", "中央区"],
              aliases: ["中央", "中央区"],
            },
          ],
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    try {
      const geoCoder = new GeoCoder([file]);
      expect(
        geoCoder
          .encode("中央", "ja")
          .map((place) => place.addresses[0]?.label),
      ).toEqual(["東京都中央市", "東京都中央区", "東京都"]);
      expect(
        geoCoder
          .encode("中央区", "ja")
          .map((place) => place.addresses[0]?.label),
      ).toEqual(["東京都中央区", "東京都"]);
      expect(
        geoCoder
          .encode("東京都中央区", "ja")
          .map((place) => place.addresses[0]?.label),
      ).toEqual(["東京都中央区", "東京都"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
          kind: "municipality",
          addresses: [expect.objectContaining({ label: "埼玉県所沢市" })],
        }),
      );
    }
    expect(geoCoder.decode(0, 0, "ja")).toEqual([]);
  });

  test("sorts representative and alias points by latitude after loading", () => {
    const geoCoder = new GeoCoder([TEST_DATA]) as unknown as {
      decodePlaces: readonly { latitude: number }[];
      aliasLongitudes: Float32Array;
      aliasLatitudes: Float32Array;
      aliasBelongTo: Uint16Array | Uint32Array;
    };

    expect(geoCoder.aliasLongitudes).toBeInstanceOf(Float32Array);
    expect(geoCoder.aliasLatitudes).toBeInstanceOf(Float32Array);
    expect(geoCoder.aliasBelongTo).toBeInstanceOf(Uint16Array);
    expect(geoCoder.decodePlaces.map((place) => place.latitude)).toEqual(
      geoCoder.decodePlaces
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

  test("rejects a reverse-geocoding alias for a designated-city parent", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "parent-alias.ndjson");
    const lines = readFileSync(TEST_DATA, "utf8").trim().split("\n");
    lines.push(JSON.stringify({ longitude: 139.65, latitude: 35.52, belongTo: 14100 }));
    writeFileSync(file, lines.join("\n"));

    try {
      expect(() => new GeoCoder([file])).toThrow(
        "alias must refer to a reverse-geocoding place: 14100",
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
          kind: "prefecture",
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
