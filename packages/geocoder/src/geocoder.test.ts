import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Config } from "./config";
import { GeoCoder } from "./geocoder";
import type { GeoPlace } from "./types";

const TEST_DATA = join(__dirname, "../test-data/geo-japan-test.ndjson");

function addressLabel(place: GeoPlace, locale: string): string | undefined {
  return place.addresses.find((address) => address.locale === locale)?.label;
}

function addressLocales(place: GeoPlace): string[] {
  return place.addresses.map((address) => address.locale);
}

describe("GeoCoder", () => {
  test("uses English as the default locale", () => {
    expect(Config.DEFAULT_LOCALE).toBe("en");

    const geoCoder = new GeoCoder([TEST_DATA]);
    const result = geoCoder.encode("Tokorozawa");

    expect(result.map((place) => addressLabel(place, "en"))).toEqual([
      "Tokorozawa, Saitama",
      "Saitama",
    ]);
    expect(result.every((place) => addressLocales(place).join(",") === "en")).toBe(true);
  });

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

  test("searches the selected locale and English spaces", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    for (const query of ["所沢", "Tokorozawa", "Tokorozawa city"]) {
      const result = geoCoder.encode(query, "ja");
      expect(result.map((place) => addressLabel(place, "ja"))).toEqual([
        "埼玉県所沢市",
        "埼玉県",
      ]);
      expect(result.every((place) => addressLocales(place).join(",") === "en,ja")).toBe(
        true,
      );
    }
  });

  test("normalizes regional locales and falls back to the base language", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    for (const locale of ["ja-JP", "ja_JP", "JA-jp"]) {
      const result = geoCoder.encode("所沢", locale);
      expect(result.map((place) => addressLabel(place, "ja"))).toEqual([
        "埼玉県所沢市",
        "埼玉県",
      ]);
      expect(result.every((place) => addressLocales(place).join(",") === "en,ja")).toBe(
        true,
      );
    }

    const english = geoCoder.encode("Tokorozawa", "EN_us");
    expect(english.map((place) => addressLabel(place, "en"))).toEqual([
      "Tokorozawa, Saitama",
      "Saitama",
    ]);
    expect(english.every((place) => addressLocales(place).join(",") === "en")).toBe(true);
  });

  test("prefers an exact regional locale over its base language", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "regional-locales.ndjson");
    writeFileSync(
      file,
      [
        {
          id: 11,
          level: 1,
          kind: "prefecture",
          country: "JP",
          longitude: 139.4,
          latitude: 35.9,
          addresses: [
            {
              locale: "en",
              label: "Saitama",
              elements: ["Saitama"],
              aliases: [],
            },
            {
              locale: "ja",
              label: "埼玉県",
              elements: ["埼玉県"],
              aliases: ["埼玉"],
            },
          ],
        },
        {
          id: 11208,
          level: 2,
          kind: "municipality",
          country: "JP",
          longitude: 139.475,
          latitude: 35.8,
          addresses: [
            {
              locale: "en",
              label: "Tokorozawa, Saitama",
              elements: ["Saitama", "Tokorozawa"],
              aliases: [],
            },
            {
              locale: "ja",
              label: "埼玉県所沢市",
              elements: ["埼玉県", "所沢市"],
              aliases: ["所沢"],
            },
            {
              locale: "ja-JP",
              label: "埼玉県所沢市",
              elements: ["埼玉県", "所沢市"],
              aliases: ["ところざわ"],
            },
          ],
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    try {
      const geoCoder = new GeoCoder([file]);
      const result = geoCoder.encode("ところざわ", "ja_JP");
      expect(addressLocales(result[0])).toEqual(["en", "ja-JP"]);
      expect(addressLocales(result[1])).toEqual(["en"]);
      expect(geoCoder.encode("ところざわ", "ja")).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("falls back unsupported locales to English", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    const result = geoCoder.encode("Tokorozawa", "fr");
    expect(result.map((place) => addressLabel(place, "en"))).toEqual([
      "Tokorozawa, Saitama",
      "Saitama",
    ]);
    expect(result.every((place) => addressLocales(place).join(",") === "en")).toBe(true);
    expect(geoCoder.encode("所沢", "fr")).toEqual([]);
  });

  test("loads English labels whose element order differs from Japanese", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    const place = geoCoder.encode("Tokorozawa")[0];
    expect(place?.addresses).toEqual([
      {
        locale: "en",
        label: "Tokorozawa, Saitama",
        elements: ["Saitama", "Tokorozawa"],
      },
    ]);
    expect(geoCoder.encode("Saitama prefecture")[0]).toEqual(
      expect.objectContaining({ kind: "prefecture" }),
    );
  });

  test("encodes and decodes designated-city wards with their parent city", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    expect(
      geoCoder.encode("鶴見", "ja").map((place) => ({
        label: addressLabel(place, "ja"),
        level: place.level,
        kind: place.kind,
        locales: addressLocales(place),
      })),
    ).toEqual([
      {
        label: "神奈川県横浜市鶴見区",
        level: 3,
        kind: "designated-city-ward",
        locales: ["en", "ja"],
      },
      {
        label: "神奈川県横浜市",
        level: 2,
        kind: "municipality",
        locales: ["en", "ja"],
      },
      {
        label: "神奈川県",
        level: 1,
        kind: "prefecture",
        locales: ["en", "ja"],
      },
    ]);

    const decoded = geoCoder.decode(139.68, 35.55, "ja")[0];
    expect(decoded).toEqual(
      expect.objectContaining({ level: 3, kind: "designated-city-ward" }),
    );
    expect(addressLabel(decoded, "ja")).toBe("神奈川県横浜市鶴見区");
    expect(addressLabel(decoded, "en")).toBe("Tsurumi, Yokohama, Kanagawa");
  });

  test("decodes with English only by default", () => {
    const geoCoder = new GeoCoder([TEST_DATA]);

    const decoded = geoCoder.decode(139.475001, 35.800026);
    expect(decoded.map((place) => addressLabel(place, "en"))).toEqual([
      "Tokorozawa, Saitama",
      "Saitama",
    ]);
    expect(decoded.every((place) => addressLocales(place).join(",") === "en")).toBe(true);
  });

  test("keeps only addresses that exist on each result record", () => {
    const directory = mkdtempSync(join(tmpdir(), "stgy-geocoder-"));
    const file = join(directory, "partial-locales.ndjson");
    writeFileSync(
      file,
      [
        {
          id: 11,
          level: 1,
          kind: "prefecture",
          country: "JP",
          longitude: 139.4,
          latitude: 35.9,
          addresses: [
            {
              locale: "ja",
              label: "埼玉県",
              elements: ["埼玉県"],
              aliases: ["埼玉"],
            },
            {
              locale: "en",
              label: "Saitama",
              elements: ["Saitama"],
              aliases: ["Saitama prefecture"],
            },
          ],
        },
        {
          id: 11208,
          level: 2,
          kind: "municipality",
          country: "JP",
          longitude: 139.475,
          latitude: 35.8,
          addresses: [
            {
              locale: "ja",
              label: "埼玉県所沢市",
              elements: ["埼玉県", "所沢市"],
              aliases: ["所沢"],
            },
          ],
        },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );

    try {
      const geoCoder = new GeoCoder([file]);
      const result = geoCoder.decode(139.475, 35.8, "ja");
      expect(addressLocales(result[0])).toEqual(["ja"]);
      expect(addressLocales(result[1])).toEqual(["en", "ja"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
      expect(geoCoder.encode("中央", "ja").map((place) => addressLabel(place, "ja"))).toEqual([
        "東京都中央市",
        "東京都中央区",
        "東京都",
      ]);
      expect(
        geoCoder.encode("中央区", "ja").map((place) => addressLabel(place, "ja")),
      ).toEqual(["東京都中央区", "東京都"]);
      expect(
        geoCoder.encode("東京都中央区", "ja").map((place) => addressLabel(place, "ja")),
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
      const decoded = geoCoder.decode(coordinates[0], coordinates[1], "ja")[0];
      expect(decoded).toEqual(
        expect.objectContaining({ level: 2, kind: "municipality" }),
      );
      expect(addressLabel(decoded, "ja")).toBe("埼玉県所沢市");
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
      const decoded = geoCoder.decode(139.4511, 35.8124, "ja")[0];
      expect(addressLabel(decoded, "ja")).toBe("埼玉県所沢市");
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
