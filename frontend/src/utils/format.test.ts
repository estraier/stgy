import {
  formatDateTime,
  formatBytes,
  normalizeLinefeeds,
  makeAbsoluteUrl,
  convertToFullWidth,
  convertForDirection,
} from "./format";

describe("formatDateTime", () => {
  test("pads each field with zeros", () => {
    const dt = new Date(1999, 8, 9, 7, 8, 9);
    expect(formatDateTime(dt)).toBe("1999/09/09 07:08");
    expect(formatDateTime(dt, undefined, true)).toBe("1999/09/09 07:08:09");
  });

  test("formats arbitrary local datetime", () => {
    const dt = new Date(2025, 0, 2, 3, 4, 5);
    expect(formatDateTime(dt)).toBe("2025/01/02 03:04");
  });

  test("formats respecting given IANA time zone", () => {
    const dt = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));
    expect(formatDateTime(dt, "UTC")).toBe("2025/01/02 03:04");
    expect(formatDateTime(dt, "Asia/Tokyo")).toBe("2025/01/02 12:04");
    expect(formatDateTime(dt, "America/Los_Angeles")).toBe("2025/01/01 19:04");
  });
});

describe("formatBytes", () => {
  test("bytes under 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("megabytes", () => {
    const MB = 1024 * 1024;
    expect(formatBytes(1 * MB)).toBe("1.0 MB");
    expect(formatBytes(10 * MB)).toBe("10 MB");
  });

  test("gigabytes and terabytes", () => {
    const GB = 1024 ** 3;
    const TB = 1024 ** 4;
    expect(formatBytes(1 * GB)).toBe("1.0 GB");
    expect(formatBytes(10 * GB)).toBe("10 GB");
    expect(formatBytes(1 * TB)).toBe("1.0 TB");
    expect(formatBytes(5.5 * TB)).toBe("5.5 TB");
  });
});

describe("normalizeLinefeeds", () => {
  test("returns empty string for falsy input", () => {
    expect(normalizeLinefeeds("")).toBe("");
  });

  test("normalizes CRLF and CR to LF", () => {
    expect(normalizeLinefeeds("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  test("collapses 3+ consecutive newlines to exactly 2", () => {
    expect(normalizeLinefeeds("a\n\n\n\nb")).toBe("a\n\nb");
    expect(normalizeLinefeeds("x\n\n\ny\n\n\n\nz")).toBe("x\n\ny\n\nz");
  });

  test("trims trailing newlines", () => {
    expect(normalizeLinefeeds("a\nb\n")).toBe("a\nb");
    expect(normalizeLinefeeds("a\nb\n\n\n")).toBe("a\nb");
  });

  test("combined normalization", () => {
    expect(normalizeLinefeeds("a\r\n\r\n\r\nb\r\n\r\n")).toBe("a\n\nb");
  });
});

describe("makeAbsoluteUrl", () => {
  test("basic cases", () => {
    expect(makeAbsoluteUrl("/")).toBe("http://localhost:3000/");
    expect(makeAbsoluteUrl("a")).toBe("http://localhost:3000/a");
    expect(makeAbsoluteUrl("/a")).toBe("http://localhost:3000/a");
    expect(makeAbsoluteUrl("a/")).toBe("http://localhost:3000/a/");
    expect(makeAbsoluteUrl("/a/b")).toBe("http://localhost:3000/a/b");
    expect(makeAbsoluteUrl(" http://a/b/c ")).toBe("http://a/b/c");
  });
});

describe("convertToFullWidth", () => {
  test("basic cases", () => {
    expect(convertToFullWidth("1978/02/11 18:35")).toBe("１９７８／０２／１１　１８：３５");
    expect(convertToFullWidth("Recent Posts")).toBe("Ｒｅｃｅｎｔ　Ｐｏｓｔｓ");
  });
});

describe("convertForDirection", () => {
  test("normal", () => {
    expect(convertForDirection("Profile", "norm")).toBe("Profile");
  });

  test("vertical", () => {
    expect(convertForDirection("Profile", "vert")).toBe("Ｐｒｏｆｉｌｅ");
  });
});
