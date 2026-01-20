import { jest } from "@jest/globals";
import {
  bytesToHex,
  hexToBytes,
  hexToDec,
  decToHex,
  hexArrayToDec,
  generateVerificationCode,
  validateEmail,
  validateLocale,
  validateTimezone,
  normalizeEmail,
  normalizeText,
  normalizeOneLiner,
  normalizeMultiLines,
  normalizeLocale,
  parseBoolean,
  maskEmailByHash,
  snakeToCamel,
  escapeForLike,
  formatDateInTz,
  int8ToBase64,
  base64ToInt8,
  bufferToInt8Array,
  int8ArrayToBuffer,
  hashString,
  serializeHashStringList,
  deserializeHashList,
} from "./format";

describe("generatePasswordHash, checkPasswordHash", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("md5", async () => {
    jest.doMock("../config", () => ({
      Config: {
        PASSWORD_CONFIG: "md5:2",
      },
    }));
    const { generatePasswordHash, checkPasswordHash } = await import("./format");
    const hash1 = await generatePasswordHash("abc");
    const hash2 = await generatePasswordHash("hello");
    expect(hash1.length).toBe(18);
    expect(hash2.length).toBe(18);
    expect(hash1).not.toEqual(hash2);
    expect(await checkPasswordHash("abc", hash1)).toBe(true);
    expect(await checkPasswordHash("hello", hash1)).toBe(false);
    expect(await checkPasswordHash("hello", hash2)).toBe(true);
    expect(await checkPasswordHash("abc", hash2)).toBe(false);
  });

  it("sha256", async () => {
    jest.doMock("../config", () => ({
      Config: {
        PASSWORD_CONFIG: "sha256:4",
      },
    }));
    const { generatePasswordHash, checkPasswordHash } = await import("./format");
    const hash1 = await generatePasswordHash("abc");
    const hash2 = await generatePasswordHash("hello");
    expect(hash1.length).toBe(36);
    expect(hash2.length).toBe(36);
    expect(hash1).not.toEqual(hash2);
    expect(await checkPasswordHash("abc", hash1)).toBe(true);
    expect(await checkPasswordHash("hello", hash1)).toBe(false);
    expect(await checkPasswordHash("hello", hash2)).toBe(true);
    expect(await checkPasswordHash("abc", hash2)).toBe(false);
  });

  it("scrypt", async () => {
    jest.doMock("../config", () => ({
      Config: {
        PASSWORD_CONFIG: "scrypt:4:16:1024:4:1",
      },
    }));
    const { generatePasswordHash, checkPasswordHash } = await import("./format");
    const hash1 = await generatePasswordHash("abc");
    const hash2 = await generatePasswordHash("hello");
    expect(hash1.length).toBe(20);
    expect(hash2.length).toBe(20);
    expect(hash1).not.toEqual(hash2);
    expect(await checkPasswordHash("abc", hash1)).toBe(true);
    expect(await checkPasswordHash("hello", hash1)).toBe(false);
    expect(await checkPasswordHash("hello", hash2)).toBe(true);
    expect(await checkPasswordHash("abc", hash2)).toBe(false);
  });
});

describe("bytesToHex, hexToBytes", () => {
  it("bytesToHex", () => {
    const arr = new Uint8Array([0x00, 0x0a, 0xff, 0x1c]);
    const hex = bytesToHex(arr);
    expect(hex).toBe("000aff1c");
  });

  it("hexToBytes success", () => {
    expect(hexToBytes("48656c6c6f")).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    expect(hexToBytes("\\x48656c6c6f")).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    expect(hexToBytes("x48656c6c6f")).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    expect(hexToBytes("48 65 6C 6C 6F")).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
  });

  it("hexToBytes failure", () => {
    expect(hexToBytes("48656c6c6")).toBeNull();
    expect(hexToBytes("48656c6c6g")).toBeNull();
  });

  it("bidirection", () => {
    const arrays = [new Uint8Array([0]), new Uint8Array([0, 1, 2, 128, 255])];
    for (const array of arrays) {
      const hex = bytesToHex(array);
      const restored = hexToBytes(hex);
      expect(restored).toEqual(array);
    }
  });
});

describe("hexToDec, decToHex, hexArrayToDec", () => {
  const TWO64 = 1n << 64n;
  const U64_MAX = TWO64 - 1n;
  const I64_MIN = -(1n << 63n);

  function normalizeToUint64Dec(v: unknown): string {
    const s = String(v).trim();
    let n = BigInt(s);
    if (n < 0n) {
      if (n < I64_MIN) throw new Error("below int64");
      n = n + TWO64;
    }
    if (n < 0n || n > U64_MAX) throw new Error("exceeds u64");
    return n.toString(10);
  }

  it("hexToDec converts 64-bit hex (with/without 0x, any case) to unsigned decimal string", () => {
    expect(hexToDec("0")).toBe("0");
    expect(hexToDec("1")).toBe("1");
    expect(hexToDec("a")).toBe("10");
    expect(hexToDec("0xA")).toBe("10");
    expect(hexToDec("00000000000000A1")).toBe("161");
    expect(hexToDec("00000000000000b0")).toBe("176");
    expect(hexToDec("0x00000000000000c0")).toBe("192");
    expect(hexToDec("7FFFFFFFFFFFFFFF")).toBe("9223372036854775807");
    expect(hexToDec("8000000000000000")).toBe("9223372036854775808");
    expect(hexToDec("FFFFFFFFFFFFFFFF")).toBe("18446744073709551615");
  });

  it("hexToDec rejects invalid inputs", () => {
    expect(() => hexToDec("")).toThrow("invalid hex string");
    expect(() => hexToDec("0x")).toThrow("invalid hex string");
    expect(() => hexToDec("G")).toThrow("invalid hex string");
    expect(() => hexToDec("-1")).toThrow("invalid hex string");
    expect(() => hexToDec("00000000000000000")).toThrow("invalid hex string");
    expect(() => hexToDec("0x00000000000000000")).toThrow("invalid hex string");
  });

  it("decToHex converts decimal-like input to 16-char uppercase hex (wrap negatives as uint64)", () => {
    expect(decToHex("0")).toBe("0000000000000000");
    expect(decToHex(0)).toBe("0000000000000000");
    expect(decToHex(" 161 ")).toBe("00000000000000A1");
    expect(decToHex(176)).toBe("00000000000000B0");
    expect(decToHex(192)).toBe("00000000000000C0");
    expect(decToHex("9223372036854775807")).toBe("7FFFFFFFFFFFFFFF");
    expect(decToHex("9223372036854775808")).toBe("8000000000000000");
    expect(decToHex("18446744073709551615")).toBe("FFFFFFFFFFFFFFFF");
    expect(decToHex("-9223372036854775808")).toBe("8000000000000000");
    expect(decToHex("-1")).toBe("FFFFFFFFFFFFFFFF");
  });

  it("decToHex rejects out-of-range and invalid decimal inputs", () => {
    expect(() => decToHex(null)).toThrow("invalid decimal value");
    expect(() => decToHex(undefined)).toThrow("invalid decimal value");
    expect(() => decToHex("")).toThrow("invalid decimal value");
    expect(() => decToHex("abc")).toThrow("invalid decimal value");

    expect(() => decToHex("18446744073709551616")).toThrow("value exceeds 64-bit range");
    expect(() => decToHex("-9223372036854775809")).toThrow("value below int64 range");
  });

  it("round-trips (normalized): hexToDec(decToHex(x)) === uint64-normalized decimal", () => {
    const values = [
      "0",
      "1",
      "10",
      "161",
      "9223372036854775807",
      "9223372036854775808",
      "18446744073709551615",
      "-1",
      "-2",
      "-9223372036854775808",
    ];
    values.forEach((v) => {
      expect(hexToDec(decToHex(v))).toBe(normalizeToUint64Dec(v));
    });
  });

  it("round-trips: decToHex(hexToDec(x)) === normalized 16-digit uppercase hex", () => {
    const hexes = [
      "0",
      "00000000000000a1",
      "00000000000000B0",
      "7fffffffffffffff",
      "8000000000000000",
      "ffffffffffffffff",
      "0x0000000000000001",
      "0xFFFFFFFFFFFFFFFF",
    ];
    const norm = [
      "0000000000000000",
      "00000000000000A1",
      "00000000000000B0",
      "7FFFFFFFFFFFFFFF",
      "8000000000000000",
      "FFFFFFFFFFFFFFFF",
      "0000000000000001",
      "FFFFFFFFFFFFFFFF",
    ];
    hexes.forEach((h, i) => {
      expect(decToHex(hexToDec(h))).toBe(norm[i]);
    });
  });

  it("hexArrayToDec maps an array of hex strings to unsigned decimal strings", () => {
    const arr = ["00000000000000A1", "00000000000000B0", "0x00000000000000C0"];
    expect(hexArrayToDec(arr)).toEqual(["161", "176", "192"]);
  });

  it("hexArrayToDec supports values with sign bit set as uint64", () => {
    const arr = ["7FFFFFFFFFFFFFFF", "8000000000000000", "FFFFFFFFFFFFFFFF"];
    expect(hexArrayToDec(arr)).toEqual([
      "9223372036854775807",
      "9223372036854775808",
      "18446744073709551615",
    ]);
  });
});

describe("generateVerificationCode", () => {
  it("returns a 6-digit string", () => {
    for (let i = 0; i < 10; ++i) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("pads with zeros when number is short", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.000001);
    expect(generateVerificationCode()).toBe("000001");
    jest.spyOn(Math, "random").mockRestore();
  });
});

describe("validateEmail", () => {
  it("returns true for valid emails", () => {
    const valids = [
      "foo@example.com",
      "user.name+tag@sub.domain.com",
      "A_B.C-d@domain.co.jp",
      "user@localhost",
      "user@a.b",
      "user123@xn--zckzah.jp",
      "user%test@domain.info",
      "a@b.c",
      "a@b.co",
    ];
    valids.forEach((email) => {
      expect(validateEmail(email)).toBe(true);
    });
  });

  it("returns false for invalid emails", () => {
    const invalids = [
      "",
      "fooexample.com",
      "@example.com",
      "foo@",
      "foo@.com",
      "foo@com.",
      "foo@.com.",
      "foo@com..com",
      "foo@#$.com",
      "foo@com,com",
      "foo@ example.com",
      "foo @example.com",
      "foo@ex ample.com",
      "foo@.example.com",
      "foo@@example.com",
      "foo@example..com",
      "foo@example.com ",
      " foo@example.com",
      "foo@exam\nple.com",
    ];
    invalids.forEach((email) => {
      expect(validateEmail(email)).toBe(false);
    });
  });
});

describe("validateLocale", () => {
  it("valid locales", () => {
    expect(validateLocale("ja-JP")).toBe(true);
    expect(validateLocale("en-US")).toBe(true);
    expect(validateLocale("zh-Hant-TW")).toBe(true);
  });

  it("invalid locales", () => {
    expect(validateLocale("")).toBe(false);
    expect(validateLocale("en--US")).toBe(false);
    expect(validateLocale("en-US-")).toBe(false);
  });
});

describe("validateTimezone", () => {
  it("valid timezones", () => {
    expect(validateTimezone("UTC")).toBe(true);
    expect(validateTimezone("Asia/Tokyo")).toBe(true);
    expect(validateTimezone("Europe/London")).toBe(true);
  });

  it("invalid timezones", () => {
    expect(validateTimezone("")).toBe(false);
    expect(validateTimezone("Asia/Tokyoo")).toBe(false);
    expect(validateTimezone("GMT+9")).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("normalize", () => {
    expect(normalizeEmail("  ADMIN@stgy.jp  ")).toBe("admin@stgy.jp");
  });
});

describe("normalizeText", () => {
  it("undefiend and null", () => {
    expect(normalizeText(undefined) === undefined);
    expect(normalizeText(null) === null);
  });

  it("keep spaces", () => {
    expect(normalizeText("  foo bar  ")).toBe("  foo bar  ");
  });
});

describe("normalizeOneLiner", () => {
  it("undefiend and null", () => {
    expect(normalizeOneLiner(undefined) === undefined);
    expect(normalizeOneLiner(null) === null);
  });

  it("removes leading/trailing spaces", () => {
    expect(normalizeOneLiner("  foo bar  ")).toBe("foo bar");
  });

  it("converts all Unicode spaces to 0x20 and trims", () => {
    expect(normalizeOneLiner("foo\u00A0bar\u3000baz")).toBe("foo bar baz");
    expect(normalizeOneLiner("\u2002foo\tbar\nbaz\u3000")).toBe("foo bar baz");
  });

  it("normalizes Unicode to NFC", () => {
    const input = "Cafe\u0301";
    const expected = "Café";
    expect(normalizeOneLiner(input)).toBe(expected);
  });

  it("collapses consecutive spaces to a single space", () => {
    expect(normalizeOneLiner("foo    bar   baz")).toBe("foo bar baz");
    expect(normalizeOneLiner("foo\t\tbar\nbaz")).toBe("foo bar baz");
  });

  it("returns empty string for only spaces", () => {
    expect(normalizeOneLiner("   \t\n\u3000  ")).toBe("");
  });

  it("returns input as is if already normalized", () => {
    expect(normalizeOneLiner("foo bar")).toBe("foo bar");
  });
});

describe("normalizeMultiLines", () => {
  it("undefiend and null", () => {
    expect(normalizeMultiLines(undefined) === undefined);
    expect(normalizeMultiLines(null) === null);
  });

  it("removes successive and trailing spaces", () => {
    expect(normalizeMultiLines("  foo \n\n\nbar \nbaz\n")).toBe("  foo\n\n\nbar\nbaz");
  });
});

describe("normalizeLocale", () => {
  test("returns input as-is for null/undefined/empty", () => {
    expect(normalizeLocale(undefined)).toBeUndefined();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale("")).toBe("");
  });

  test("trims whitespace (whitespace-only becomes empty string)", () => {
    expect(normalizeLocale("  ja_JP  ")).toBe("ja-JP");
    expect(normalizeLocale("   ")).toBe("");
    expect(normalizeLocale("\n\t en_US \r")).toBe("en-US");
  });

  test("replaces underscore with hyphen", () => {
    expect(normalizeLocale("ja_JP")).toBe("ja-JP");
    expect(normalizeLocale("en__US")).toBe("en-US");
  });

  test("normalizes repeated/edge hyphens", () => {
    expect(normalizeLocale("-en-US-")).toBe("en-US");
    expect(normalizeLocale("--en---us--")).toBe("en-US");
    expect(normalizeLocale("___en___us___")).toBe("en-US");
  });

  test("lowercases first subtag if 2-3 ASCII letters", () => {
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("eN")).toBe("en");
    expect(normalizeLocale("ENG")).toBe("eng");
    expect(normalizeLocale("Eng-US")).toBe("eng-US");
  });

  test("uppercases subsequent subtags if 2-3 ASCII letters", () => {
    expect(normalizeLocale("en-us")).toBe("en-US");
    expect(normalizeLocale("eng-usa")).toBe("eng-USA");
    expect(normalizeLocale("ja-jpn")).toBe("ja-JPN");
  });

  test("does not change non-2/3-letter subtags (except underscore->hyphen)", () => {
    expect(normalizeLocale("zh-Hant-TW")).toBe("zh-Hant-TW");
    expect(normalizeLocale("sr_latn_RS")).toBe("sr-latn-RS");
    expect(normalizeLocale("abcd-ef")).toBe("abcd-EF");
    expect(normalizeLocale("123-ab")).toBe("123-AB");
  });

  test("drops empty segments after normalization", () => {
    expect(normalizeLocale("en--US")).toBe("en-US");
    expect(normalizeLocale("en---")).toBe("en");
    expect(normalizeLocale("---")).toBe("");
  });
});

describe("parseBoolean", () => {
  it("default values", () => {
    expect(parseBoolean(undefined) === false);
    expect(parseBoolean(null) === false);
    expect(parseBoolean("") === false);
    expect(parseBoolean("abc") === false);
    expect(parseBoolean(undefined, true) === true);
    expect(parseBoolean(null, true) === true);
    expect(parseBoolean("", true) === true);
    expect(parseBoolean("abc", true) === true);
  });

  it("matching true expressions", () => {
    expect(parseBoolean("true", false) === true);
    expect(parseBoolean("1", false) === true);
    expect(parseBoolean("yes", false) === true);
    expect(parseBoolean("on", false) === true);
  });

  it("matching false expressions", () => {
    expect(parseBoolean("false", true) === false);
    expect(parseBoolean("0", true) === false);
    expect(parseBoolean("no", true) === false);
    expect(parseBoolean("off", true) === false);
  });
});

describe("maskEmailByHash", () => {
  it("returns a masked email for typical addresses", () => {
    expect(maskEmailByHash("foo1@example.com")).toMatch(/^[a-z]{2}[0-9]{8}@stgy\.jp$/);
    expect(maskEmailByHash("bar1@example.net")).toMatch(/^[a-z]{2}[0-9]{8}@stgy\.jp$/);
    expect(maskEmailByHash("hoge1@domain.co.jp")).toMatch(/^[a-z]{2}[0-9]{8}@stgy\.jp$/);
    expect(maskEmailByHash("user+spam@a-b.com")).toMatch(/^[a-z]{2}[0-9]{8}@stgy\.jp$/);
  });

  it("returns different masked values for different inputs", () => {
    const masked1 = maskEmailByHash("foo@stgy.jp");
    const masked2 = maskEmailByHash("bar@stgy.jp");
    expect(masked1).not.toBe(masked2);
  });
});

describe("snakeToCamel", () => {
  it("converts snake_case object keys to camelCase", () => {
    const input = {
      user_id: "1",
      created_at: "2023-01-01T00:00:00Z",
      user_name: "Taro",
      is_admin: false,
      ai_model: "gpt-4",
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      userId: "1",
      createdAt: "2023-01-01T00:00:00Z",
      userName: "Taro",
      isAdmin: false,
      aiModel: "gpt-4",
    });
  });

  it("recursively converts arrays and nested objects", () => {
    const input = {
      post_id: "abc",
      user: {
        user_id: "1",
        is_admin: true,
      },
      tags: [
        { tag_id: "x", tag_name: "tag1" },
        { tag_id: "y", tag_name: "tag2" },
      ],
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      postId: "abc",
      user: {
        userId: "1",
        isAdmin: true,
      },
      tags: [
        { tagId: "x", tagName: "tag1" },
        { tagId: "y", tagName: "tag2" },
      ],
    });
  });

  it("handles Date objects (e.g., timestamptz)", () => {
    const date = new Date("2023-01-01T12:34:56.789Z");
    const input = { created_at: date };
    const result = snakeToCamel(input);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect((result.createdAt as Date).toISOString()).toBe("2023-01-01T12:34:56.789Z");
  });

  it("handles Buffer objects (e.g., bytea)", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const input = { file_content: buf };
    const result = snakeToCamel(input);
    expect(result.fileContent).toBeInstanceOf(Buffer);
    expect((result.fileContent as Buffer).equals(buf)).toBe(true);
  });
});

describe("escapeForLike", () => {
  it("escapeMetaChars", () => {
    expect(escapeForLike("%abc%")).toBe("\\%abc\\%");
    expect(escapeForLike("_abc_")).toBe("\\_abc\\_");
    expect(escapeForLike("\\abc\\")).toBe("\\\\abc\\\\");
  });
});

describe("formatDateInTz", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    const ms = Date.UTC(2025, 8, 29, 0, 0, 0);
    expect(formatDateInTz(ms, "UTC")).toBe("2025-09-29");
  });

  it("uses the given timezone (Asia/Tokyo) and crosses into the next local day", () => {
    const ms = Date.UTC(2025, 8, 28, 16, 0, 0);
    expect(formatDateInTz(ms, "Asia/Tokyo")).toBe("2025-09-29");
  });
});

const int8eq = (a: Int8Array, b: Int8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

describe("bufferToInt8Array", () => {
  test("converts Buffer bytes to signed Int8Array values", () => {
    const buf = Buffer.from([0x80, 0xff, 0x00, 0x01, 0x7f]);
    const v = bufferToInt8Array(buf);
    expect(Array.from(v)).toEqual([-128, -1, 0, 1, 127]);
  });

  test("handles Buffer slice (non-zero byteOffset)", () => {
    const base = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const slice = base.subarray(2, 6);
    const v = bufferToInt8Array(slice);
    expect(Array.from(v)).toEqual([2, 3, 4, 5]);
  });
});

describe("int8ArrayToBuffer", () => {
  test("converts signed Int8Array values to Buffer bytes", () => {
    const v = new Int8Array([-128, -1, 0, 1, 127]);
    const buf = int8ArrayToBuffer(v);
    expect(Array.from(buf)).toEqual([128, 255, 0, 1, 127]);
  });

  test("handles Int8Array view (non-zero byteOffset)", () => {
    const u8 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const view = new Int8Array(u8.buffer, 2, 4);
    const buf = int8ArrayToBuffer(view);
    expect(Array.from(buf)).toEqual([2, 3, 4, 5]);
  });

  test("round-trip: Buffer -> Int8Array -> Buffer (bytes preserved)", () => {
    const samples = [
      Buffer.from([]),
      Buffer.from([0, 1, 2, 3, 4, 5]),
      Buffer.from([128, 255, 0, 1, 127]),
    ];
    for (const src of samples) {
      const i8 = bufferToInt8Array(src);
      const dst = int8ArrayToBuffer(i8);
      expect(dst.equals(src)).toBe(true);
    }
  });

  test("round-trip: Int8Array -> Buffer -> Int8Array (values preserved)", () => {
    const samples = [new Int8Array([]), new Int8Array([1, -2, 3, 4, 127, -128, 0, -1])];
    for (const src of samples) {
      const buf = int8ArrayToBuffer(src);
      const dst = bufferToInt8Array(buf);
      expect(int8eq(dst, src)).toBe(true);
    }
  });
});

describe("int8ToBase64", () => {
  test("encodes known bytes", () => {
    const v = new Int8Array([-128, -1, 0, 1, 127]);
    expect(int8ToBase64(v)).toBe("gP8AAX8=");
  });

  test("encodes Int8Array view with non-zero byteOffset", () => {
    const u8 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const view = new Int8Array(u8.buffer, 2, 4);
    expect(int8ToBase64(view)).toBe("AgMEBQ==");
  });

  test("encodes empty array to empty string", () => {
    expect(int8ToBase64(new Int8Array([]))).toBe("");
  });
});

describe("base64ToInt8", () => {
  test("decodes known base64", () => {
    const v = base64ToInt8("gP8AAX8=");
    expect(Array.from(v)).toEqual([-128, -1, 0, 1, 127]);
  });

  test("decodes empty string to empty Int8Array", () => {
    const v = base64ToInt8("");
    expect(v).toBeInstanceOf(Int8Array);
    expect(v.length).toBe(0);
  });

  test("round-trip: int8ToBase64 -> base64ToInt8", () => {
    const src = new Int8Array([1, -2, 3, 4, 127, -128, 0, -1]);
    const b64 = int8ToBase64(src);
    const dst = base64ToInt8(b64);
    expect(int8eq(dst, src)).toBe(true);
  });
});

describe("Hash Utils", () => {
  describe("hashString", () => {
    it("should return correct FNV-1a 32-bit hash values", () => {
      expect(hashString("apple")).toBe(280767167);
      expect(hashString("orange")).toBe(1169454059);
      expect(hashString("")).toBe(2166136261);
    });

    it("should return different hashes for different strings", () => {
      expect(hashString("abc")).not.toBe(hashString("abd"));
    });

    it("should always return a value within unsigned 32-bit integer range", () => {
      const result = hashString("long_test_string_to_check_range");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(4294967295);
    });
  });

  describe("serialization and deserialization", () => {
    it("should maintain integrity through serialize and deserialize process", () => {
      const inputs = ["typescript", "jest", "hash", "fnv1a"];
      const expectedHashes = inputs.map(hashString);

      const serialized = serializeHashStringList(inputs);
      expect(serialized.length).toBe(inputs.length * 4);

      const deserialized = deserializeHashList(serialized);
      expect(deserialized).toEqual(expectedHashes);
    });

    it("should handle empty arrays correctly", () => {
      const serialized = serializeHashStringList([]);
      expect(serialized.length).toBe(0);

      const deserialized = deserializeHashList(serialized);
      expect(deserialized).toEqual([]);
    });

    it("should correctly read Big Endian byte order", () => {
      const data = new Uint8Array([0, 0, 0, 1, 0, 0, 1, 0]);
      const result = deserializeHashList(data);
      expect(result).toEqual([1, 256]);
    });
  });

  describe("validation", () => {
    it("should throw an error if the byte length is not a multiple of 4", () => {
      const invalidData = new Uint8Array([1, 2, 3]);
      expect(() => {
        deserializeHashList(invalidData);
      }).toThrow("Invalid data length: Must be a multiple of 4 bytes.");
    });
  });
});
