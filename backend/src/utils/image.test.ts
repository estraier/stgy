import { describe, expect, test } from "@jest/globals";
import { sniffFormat, readDimensions } from "./image";

function fourCC(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function u16be(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function u24le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
}

function makePNG(w: number, h: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrLen = u32be(13);
  const ihdr = fourCC("IHDR");
  const wh = [...u32be(w), ...u32be(h)];
  const fakeCRC = [0, 0, 0, 0];
  return new Uint8Array([...sig, ...ihdrLen, ...ihdr, ...wh, ...fakeCRC]);
}

function makeJPEG(w: number, h: number): Uint8Array {
  const soi = [0xff, 0xd8];
  const sof0Marker = [0xff, 0xc0];
  const segLen = u16be(11 + 2);
  const precision = [8];
  const dims = [...u16be(h), ...u16be(w)];
  const rest = Array(6).fill(0);
  return new Uint8Array([...soi, ...sof0Marker, ...segLen, ...precision, ...dims, ...rest]);
}

function makeWebP_VP8X(w: number, h: number): Uint8Array {
  const riff = fourCC("RIFF");
  const size = u32le(30);
  const webp = fourCC("WEBP");
  const vp8x = fourCC("VP8X");
  const chunkSize = u32le(10);
  const flagsAndReserved = [0, 0, 0, 0];
  const wMinus1 = u24le(w - 1);
  const hMinus1 = u24le(h - 1);
  return new Uint8Array([
    ...riff,
    ...size,
    ...webp,
    ...vp8x,
    ...chunkSize,
    ...flagsAndReserved,
    ...wMinus1,
    ...hMinus1,
  ]);
}

function makeWebP_VP8(w: number, h: number): Uint8Array {
  const riff = fourCC("RIFF");
  const webp = fourCC("WEBP");
  const vp8 = fourCC("VP8 ");
  const payload = new Array(10).fill(0);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload[6] = w & 0xff;
  payload[7] = (w >>> 8) & 0xff;
  payload[8] = h & 0xff;
  payload[9] = (h >>> 8) & 0xff;
  const chunkSize = u32le(payload.length);
  const riffSize = u32le(4 + 4 + 4 + payload.length);
  return new Uint8Array([...riff, ...riffSize, ...webp, ...vp8, ...chunkSize, ...payload]);
}

function makeWebP_VP8L(w: number, h: number): Uint8Array {
  const riff = fourCC("RIFF");
  const size = u32le(5 + 4 + 4 + 4);
  const webp = fourCC("WEBP");
  const vp8l = fourCC("VP8L");
  const chunkSize = u32le(5);
  const bitsW = (w - 1) & 0x3fff;
  const bitsH = (h - 1) & 0x3fff;
  const bits = (bitsW | (bitsH << 14)) >>> 0;
  const payload = [0x2f, ...u32le(bits)];
  return new Uint8Array([...riff, ...size, ...webp, ...vp8l, ...chunkSize, ...payload]);
}

describe("sniffFormat", () => {
  test("JPEG", () => {
    const bytes = makeJPEG(400, 300);
    expect(sniffFormat(bytes)).toEqual({ ok: true, mime: "image/jpeg" });
  });

  test("PNG with valid IHDR", () => {
    const bytes = makePNG(640, 480);
    expect(sniffFormat(bytes)).toEqual({ ok: true, mime: "image/png" });
  });

  test("PNG with invalid IHDR length -> not ok", () => {
    const bad = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...u32be(12),
      ...fourCC("IHDR"),
      ...u32be(1),
      ...u32be(1),
    ]);
    expect(sniffFormat(bad).ok).toBe(false);
  });

  test("WEBP VP8X", () => {
    const bytes = makeWebP_VP8X(1024, 768);
    expect(sniffFormat(bytes)).toEqual({ ok: true, mime: "image/webp" });
  });

  test("WEBP VP8", () => {
    const bytes = makeWebP_VP8(320, 240);
    expect(sniffFormat(bytes)).toEqual({ ok: true, mime: "image/webp" });
  });

  test("WEBP VP8L", () => {
    const bytes = makeWebP_VP8L(333, 222);
    expect(sniffFormat(bytes)).toEqual({ ok: true, mime: "image/webp" });
  });

  test("unknown bytes -> not ok", () => {
    expect(sniffFormat(new Uint8Array([1, 2, 3, 4, 5])).ok).toBe(false);
  });
});

describe("readDimensions", () => {
  test("PNG dimensions", () => {
    const w = 640,
      h = 480;
    const bytes = makePNG(w, h);
    expect(readDimensions(bytes, "image/png")).toEqual({ w, h });
  });

  test("JPEG dimensions (SOF0)", () => {
    const w = 400,
      h = 300;
    const bytes = makeJPEG(w, h);
    expect(readDimensions(bytes, "image/jpeg")).toEqual({ w, h });
  });

  test("WEBP VP8X dimensions", () => {
    const w = 1024,
      h = 768;
    const bytes = makeWebP_VP8X(w, h);
    expect(readDimensions(bytes, "image/webp")).toEqual({ w, h });
  });

  test("WEBP VP8 dimensions", () => {
    const w = 320,
      h = 240;
    const bytes = makeWebP_VP8(w, h);
    expect(readDimensions(bytes, "image/webp")).toEqual({ w, h });
  });

  test("WEBP VP8L dimensions", () => {
    const w = 333,
      h = 222;
    const bytes = makeWebP_VP8L(w, h);
    expect(readDimensions(bytes, "image/webp")).toEqual({ w, h });
  });

  test("mismatched mime -> null", () => {
    const bytes = makePNG(10, 10);
    expect(readDimensions(bytes, "image/webp")).toBeNull();
  });

  test("truncated data -> null", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e]);
    expect(readDimensions(bytes, "image/png")).toBeNull();
  });
});
