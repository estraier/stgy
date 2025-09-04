function u16be(bytes: Uint8Array, off: number): number {
  if (off + 2 > bytes.length) return -1;
  return ((bytes[off] << 8) | bytes[off + 1]) >>> 0;
}
function u24le(bytes: Uint8Array, off: number): number {
  if (off + 3 > bytes.length) return -1;
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16)) >>> 0;
}
function u32be(bytes: Uint8Array, off: number): number {
  if (off + 4 > bytes.length) return -1;
  return (
    ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
  );
}
function u32le(bytes: Uint8Array, off: number): number {
  if (off + 4 > bytes.length) return -1;
  return (
    (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
  );
}
function fourCC(bytes: Uint8Array, off: number): string {
  if (off + 4 > bytes.length) return "";
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

export function sniffFormat(bytes: Uint8Array): { ok: boolean; mime?: string } {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: "image/jpeg" };
  }
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const ihdrLen = u32be(bytes, 8);
    const ihdrType = fourCC(bytes, 12);
    if (ihdrLen === 13 && ihdrType === "IHDR") return { ok: true, mime: "image/png" };
    return { ok: false };
  }
  if (bytes.length >= 16 && fourCC(bytes, 0) === "RIFF" && fourCC(bytes, 8) === "WEBP") {
    const chunkTag = fourCC(bytes, 12);
    if (chunkTag === "VP8 " || chunkTag === "VP8L" || chunkTag === "VP8X") {
      return { ok: true, mime: "image/webp" };
    }
    return { ok: false };
  }
  if (bytes.length >= 20) {
    const boxSize = u32be(bytes, 0);
    const boxType = fourCC(bytes, 4);
    if (boxType === "ftyp" && boxSize >= 16) {
      const major = fourCC(bytes, 8);
      const allowed = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif", "heis"]);
      if (allowed.has(major)) return { ok: true, mime: "image/heic" };
      const end = Math.min(bytes.length, boxSize);
      for (let p = 16; p + 4 <= end; p += 4) {
        if (allowed.has(fourCC(bytes, p))) return { ok: true, mime: "image/heic" };
      }
      return { ok: false };
    }
  }
  return { ok: false };
}

function readPngDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const ihdrLen = u32be(bytes, 8);
  if (ihdrLen !== 13 || fourCC(bytes, 12) !== "IHDR") return null;
  const w = u32be(bytes, 16);
  const h = u32be(bytes, 20);
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

function readWebpDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  if (fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") return null;
  const tag = fourCC(bytes, 12);
  if (tag === "VP8X") {
    if (bytes.length < 30) return null;
    const w = u24le(bytes, 24) + 1;
    const h = u24le(bytes, 27) + 1;
    if (w <= 0 || h <= 0) return null;
    return { w, h };
  } else if (tag === "VP8 ") {
    const chunkSize = u32le(bytes, 16);
    const dataOff = 20;
    if (bytes.length < dataOff + 10 || chunkSize < 10) return null;
    const searchEnd = Math.min(bytes.length, dataOff + 64);
    for (let i = dataOff; i + 9 < searchEnd; i++) {
      if (bytes[i + 3] === 0x9d && bytes[i + 4] === 0x01 && bytes[i + 5] === 0x2a) {
        const w = u16be(bytes, i + 6);
        const h = u16be(bytes, i + 8);
        if (w <= 0 || h <= 0) return null;
        return { w, h };
      }
    }
    return null;
  } else if (tag === "VP8L") {
    const dataOff = 20;
    if (bytes.length < dataOff + 5) return null;
    if (bytes[dataOff] !== 0x2f) return null;
    const bits =
      bytes[dataOff + 1] |
      (bytes[dataOff + 2] << 8) |
      (bytes[dataOff + 3] << 16) |
      (bytes[dataOff + 4] << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    if (w <= 0 || h <= 0) return null;
    return { w, h };
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 3 < bytes.length) {
    while (p < bytes.length && bytes[p] === 0xff) p++;
    if (p >= bytes.length) break;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (p + 1 >= bytes.length) return null;
    const segLen = u16be(bytes, p);
    if (segLen < 2) return null;
    const segStart = p + 2;
    const segEnd = segStart + segLen - 2;
    if (segEnd > bytes.length) return null;
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc;
    if (isSOF) {
      if (segStart + 5 >= bytes.length) return null;
      const h = u16be(bytes, segStart + 1);
      const w = u16be(bytes, segStart + 3);
      if (w <= 0 || h <= 0) return null;
      return { w, h };
    }
    p = segEnd;
  }
  return null;
}

function readHeicDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  const limit = bytes.length;
  let i = 0;
  while (i + 12 <= limit) {
    const size = u32be(bytes, i);
    const type = fourCC(bytes, i + 4);
    if (size < 8) return null;
    const end = i + size;
    if (end > limit) return null;
    if (type === "ispe") {
      if (i + 20 > limit) return null;
      const w = u32be(bytes, i + 12);
      const h = u32be(bytes, i + 16);
      if (w <= 0 || h <= 0) return null;
      return { w, h };
    }
    i = end;
  }
  return null;
}

export function readDimensions(bytes: Uint8Array, mime: string): { w: number; h: number } | null {
  switch (mime) {
    case "image/png":
      return readPngDimensions(bytes);
    case "image/webp":
      return readWebpDimensions(bytes);
    case "image/jpeg":
      return readJpegDimensions(bytes);
    case "image/heic":
      return readHeicDimensions(bytes);
    default:
      return null;
  }
}
