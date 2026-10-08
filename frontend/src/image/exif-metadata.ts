import { createLibRawInstance, createLibRawWorkerFailure, isRawImageFile, type LibRawMetadataLike } from "./libraw";

export type PreservedGpsMetadata = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

export type PreservedImageMetadata = {
  dateTimeOriginal?: string;
  subSecTimeOriginal?: string;
  offsetTimeOriginal?: string;
  dateTimeDigitized?: string;
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  focalLength?: number;
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
  exposureBiasValue?: number;
  meteringMode?: number;
  flash?: number;
  exposureProgram?: number;
  artist?: string;
  copyright?: string;
  imageDescription?: string;
  gps?: PreservedGpsMetadata;
};

type TiffEndian = "little" | "big";

type TiffValue = number | string | number[] | null;


const EXIF_ASCII_MAX = 4096;
const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

function cleanAscii(value: unknown, maxLength = EXIF_ASCII_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\0.*$/s, "").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? Math.round(number) : undefined;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function isJpeg(view: DataView): boolean {
  return view.byteLength >= 2 && view.getUint16(0, false) === 0xffd8;
}

function isPng(view: DataView): boolean {
  if (view.byteLength < 8) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < sig.length; index += 1) {
    if (view.getUint8(index) !== sig[index]) return false;
  }
  return true;
}

function isWebP(view: DataView): boolean {
  return view.byteLength >= 12 && readAscii(view, 0, 4) === "RIFF" && readAscii(view, 8, 4) === "WEBP";
}

function tiffEndian(view: DataView, tiffStart: number, byteLength: number): TiffEndian | null {
  if (byteLength < 8 || tiffStart < 0 || tiffStart + byteLength > view.byteLength) return null;
  const order = view.getUint16(tiffStart, false);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  if (view.getUint16(tiffStart + 2, little) !== 42) return null;
  return little ? "little" : "big";
}

function readTiffEntryValue(
  view: DataView,
  tiffStart: number,
  byteLength: number,
  entryOffset: number,
  endian: TiffEndian,
): TiffValue {
  const little = endian === "little";
  if (entryOffset < tiffStart || entryOffset + 12 > tiffStart + byteLength) return null;
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  const unitSize = TIFF_TYPE_SIZE[type];
  if (!unitSize || count <= 0) return null;
  const totalSize = unitSize * count;
  let dataOffset = entryOffset + 8;
  if (totalSize > 4) {
    const relative = view.getUint32(entryOffset + 8, little);
    dataOffset = tiffStart + relative;
  }
  if (dataOffset < tiffStart || dataOffset + totalSize > tiffStart + byteLength) return null;

  if (type === 2) {
    const length = Math.min(count, EXIF_ASCII_MAX + 1);
    let text = "";
    for (let index = 0; index < length; index += 1) {
      const byte = view.getUint8(dataOffset + index);
      if (byte === 0) break;
      text += String.fromCharCode(byte);
    }
    return text;
  }

  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = dataOffset + index * unitSize;
    let value: number;
    switch (type) {
      case 1:
      case 7:
        value = view.getUint8(offset);
        break;
      case 3:
        value = view.getUint16(offset, little);
        break;
      case 4:
        value = view.getUint32(offset, little);
        break;
      case 5: {
        const numerator = view.getUint32(offset, little);
        const denominator = view.getUint32(offset + 4, little);
        value = denominator === 0 ? Number.NaN : numerator / denominator;
        break;
      }
      case 9:
        value = view.getInt32(offset, little);
        break;
      case 10: {
        const numerator = view.getInt32(offset, little);
        const denominator = view.getInt32(offset + 4, little);
        value = denominator === 0 ? Number.NaN : numerator / denominator;
        break;
      }
      default:
        return null;
    }
    values.push(value);
  }
  return values.length === 1 ? values[0] : values;
}

function readIfd(
  view: DataView,
  tiffStart: number,
  byteLength: number,
  ifdOffset: number,
  endian: TiffEndian,
): Map<number, TiffValue> {
  const output = new Map<number, TiffValue>();
  if (!Number.isFinite(ifdOffset) || ifdOffset <= 0) return output;
  const little = endian === "little";
  const start = tiffStart + ifdOffset;
  if (start < tiffStart || start + 2 > tiffStart + byteLength) return output;
  const count = view.getUint16(start, little);
  if (count > 4096 || start + 2 + count * 12 + 4 > tiffStart + byteLength) return output;
  for (let index = 0; index < count; index += 1) {
    const entryOffset = start + 2 + index * 12;
    const tag = view.getUint16(entryOffset, little);
    output.set(tag, readTiffEntryValue(view, tiffStart, byteLength, entryOffset, endian));
  }
  return output;
}

function firstNumber(value: TiffValue | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value) && value.length > 0) {
    const number = Number(value[0]);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function numberArray(value: TiffValue | undefined): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : undefined;
}

function tagString(ifd: Map<number, TiffValue>, tag: number): string | undefined {
  return cleanAscii(ifd.get(tag));
}

function tagNumber(ifd: Map<number, TiffValue>, tag: number): number | undefined {
  return firstNumber(ifd.get(tag));
}

function dmsToDegrees(values: number[] | undefined, ref: string | undefined): number | undefined {
  if (!values || values.length < 3 || !ref) return undefined;
  const degrees = values[0] + values[1] / 60 + values[2] / 3600;
  if (!Number.isFinite(degrees)) return undefined;
  const upper = ref.toUpperCase();
  return upper === "S" || upper === "W" ? -degrees : degrees;
}

export function parseExifTiffMetadata(
  buffer: ArrayBuffer | ArrayBufferView,
  tiffStart = 0,
  byteLength?: number,
): PreservedImageMetadata | null {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = byteLength ?? (view.byteLength - tiffStart);
  const endian = tiffEndian(view, tiffStart, length);
  if (!endian) return null;
  const little = endian === "little";
  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(view, tiffStart, length, ifd0Offset, endian);
  const exifPointer = tagNumber(ifd0, 0x8769);
  const gpsPointer = tagNumber(ifd0, 0x8825);
  const exif = exifPointer ? readIfd(view, tiffStart, length, exifPointer, endian) : new Map<number, TiffValue>();
  const gps = gpsPointer ? readIfd(view, tiffStart, length, gpsPointer, endian) : new Map<number, TiffValue>();

  const latitude = dmsToDegrees(numberArray(gps.get(0x0002)), tagString(gps, 0x0001));
  const longitude = dmsToDegrees(numberArray(gps.get(0x0004)), tagString(gps, 0x0003));
  const altitudeValue = tagNumber(gps, 0x0006);
  const altitudeRef = tagNumber(gps, 0x0005);
  const altitude = altitudeValue !== undefined
    ? (altitudeRef === 1 ? -altitudeValue : altitudeValue)
    : undefined;

  const exifOrIfd0Number = (tag: number): number | undefined =>
    tagNumber(exif, tag) ?? tagNumber(ifd0, tag);
  const exifOrIfd0String = (tag: number): string | undefined =>
    tagString(exif, tag) ?? tagString(ifd0, tag);

  const output: PreservedImageMetadata = {
    dateTimeOriginal: exifOrIfd0String(0x9003),
    subSecTimeOriginal: exifOrIfd0String(0x9291),
    offsetTimeOriginal: exifOrIfd0String(0x9011),
    dateTimeDigitized: exifOrIfd0String(0x9004),
    make: tagString(ifd0, 0x010f),
    model: tagString(ifd0, 0x0110),
    lensMake: exifOrIfd0String(0xa433),
    lensModel: exifOrIfd0String(0xa434),
    focalLength: positiveNumber(exifOrIfd0Number(0x920a)),
    exposureTime: positiveNumber(exifOrIfd0Number(0x829a)),
    fNumber: positiveNumber(exifOrIfd0Number(0x829d)),
    iso: positiveNumber(exifOrIfd0Number(0x8827)),
    exposureBiasValue: exifOrIfd0Number(0x9204),
    meteringMode: nonnegativeInteger(exifOrIfd0Number(0x9207)),
    flash: nonnegativeInteger(exifOrIfd0Number(0x9209)),
    exposureProgram: nonnegativeInteger(exifOrIfd0Number(0x8822)),
    artist: tagString(ifd0, 0x013b),
    copyright: tagString(ifd0, 0x8298),
    imageDescription: tagString(ifd0, 0x010e),
    ...(latitude !== undefined && longitude !== undefined
      ? { gps: { latitude, longitude, ...(altitude !== undefined ? { altitude } : {}) } }
      : {}),
  };
  return compactMetadata(output);
}

function findJpegExifRange(view: DataView): { start: number; length: number } | null {
  if (!isJpeg(view)) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= view.byteLength) break;
    const marker = view.getUint8(offset++);
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > view.byteLength) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) break;
    const dataStart = offset + 2;
    const dataLength = segmentLength - 2;
    if (
      marker === 0xe1 &&
      dataLength >= 6 &&
      readAscii(view, dataStart, 6) === "Exif\0\0"
    ) {
      return { start: dataStart + 6, length: dataLength - 6 };
    }
    offset += segmentLength;
  }
  return null;
}

function findPngExifRange(view: DataView): { start: number; length: number } | null {
  if (!isPng(view)) return null;
  let offset = 8;
  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    const start = offset + 8;
    if (start + length + 4 > view.byteLength) break;
    if (type === "eXIf") return { start, length };
    offset = start + length + 4;
  }
  return null;
}

function findWebPExifRange(view: DataView): { start: number; length: number; hasExifPrefix: boolean } | null {
  if (!isWebP(view)) return null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const type = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > view.byteLength) break;
    if (type === "EXIF") {
      const hasExifPrefix = length >= 6 && readAscii(view, start, 6) === "Exif\0\0";
      return { start: hasExifPrefix ? start + 6 : start, length: length - (hasExifPrefix ? 6 : 0), hasExifPrefix };
    }
    offset = start + length + (length & 1);
  }
  return null;
}


type IsoBmffBox = {
  type: string;
  start: number;
  contentStart: number;
  end: number;
};

type HeifItemExtent = {
  constructionMethod: number;
  dataReferenceIndex: number;
  baseOffset: number;
  extentOffset: number;
  extentLength: number;
};

const HEIF_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "msf1", "avif", "avis",
]);

function readIsoBmffUnsigned(view: DataView, offset: number, byteLength: number): number | null {
  if (byteLength === 0) return 0;
  if (byteLength < 0 || byteLength > 8 || offset < 0 || offset + byteLength > view.byteLength) return null;
  let value = 0;
  for (let index = 0; index < byteLength; index += 1) {
    value = value * 256 + view.getUint8(offset + index);
    if (!Number.isSafeInteger(value)) return null;
  }
  return value;
}

function readIsoBmffBoxes(view: DataView, start: number, end: number): IsoBmffBox[] {
  const boxes: IsoBmffBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    let headerSize = 8;
    let size: number;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const large = readIsoBmffUnsigned(view, offset + 8, 8);
      if (large === null) break;
      size = large;
      headerSize = 16;
    } else {
      size = size32 === 0 ? end - offset : size32;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, contentStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function isHeifContainer(view: DataView): boolean {
  const ftyp = readIsoBmffBoxes(view, 0, view.byteLength).find((box) => box.type === "ftyp");
  if (!ftyp || ftyp.contentStart + 8 > ftyp.end) return false;
  if (HEIF_BRANDS.has(readAscii(view, ftyp.contentStart, 4))) return true;
  for (let offset = ftyp.contentStart + 8; offset + 4 <= ftyp.end; offset += 4) {
    if (HEIF_BRANDS.has(readAscii(view, offset, 4))) return true;
  }
  return false;
}

function findHeifExifItemId(view: DataView, iinf: IsoBmffBox): number | null {
  if (iinf.contentStart + 6 > iinf.end) return null;
  const version = view.getUint8(iinf.contentStart);
  let offset = iinf.contentStart + 4;
  let entryCount: number;
  if (version === 0) {
    if (offset + 2 > iinf.end) return null;
    entryCount = view.getUint16(offset, false);
    offset += 2;
  } else {
    if (offset + 4 > iinf.end) return null;
    entryCount = view.getUint32(offset, false);
    offset += 4;
  }
  const entries = readIsoBmffBoxes(view, offset, iinf.end);
  for (const entry of entries.slice(0, Math.min(entryCount, entries.length))) {
    if (entry.type !== "infe" || entry.contentStart + 8 > entry.end) continue;
    const infeVersion = view.getUint8(entry.contentStart);
    let cursor = entry.contentStart + 4;
    let itemId: number;
    if (infeVersion === 2) {
      if (cursor + 8 > entry.end) continue;
      itemId = view.getUint16(cursor, false);
      cursor += 4; // item_ID + item_protection_index
    } else if (infeVersion >= 3) {
      if (cursor + 10 > entry.end) continue;
      itemId = view.getUint32(cursor, false);
      cursor += 6; // item_ID + item_protection_index
    } else {
      continue;
    }
    if (cursor + 4 <= entry.end && readAscii(view, cursor, 4) === "Exif") return itemId;
  }
  return null;
}

function findHeifItemExtents(view: DataView, iloc: IsoBmffBox, targetItemId: number): HeifItemExtent[] | null {
  if (iloc.contentStart + 8 > iloc.end) return null;
  const version = view.getUint8(iloc.contentStart);
  if (version > 2) return null;
  let cursor = iloc.contentStart + 4;
  const sizes1 = view.getUint8(cursor++);
  const sizes2 = view.getUint8(cursor++);
  const offsetSize = sizes1 >>> 4;
  const lengthSize = sizes1 & 0x0f;
  const baseOffsetSize = sizes2 >>> 4;
  const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0;
  if ([offsetSize, lengthSize, baseOffsetSize, indexSize].some((size) => size > 8)) return null;

  let itemCount: number;
  if (version < 2) {
    if (cursor + 2 > iloc.end) return null;
    itemCount = view.getUint16(cursor, false);
    cursor += 2;
  } else {
    if (cursor + 4 > iloc.end) return null;
    itemCount = view.getUint32(cursor, false);
    cursor += 4;
  }
  if (itemCount > 65536) return null;

  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const itemIdBytes = version < 2 ? 2 : 4;
    if (cursor + itemIdBytes > iloc.end) return null;
    const itemId = itemIdBytes === 2 ? view.getUint16(cursor, false) : view.getUint32(cursor, false);
    cursor += itemIdBytes;

    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      if (cursor + 2 > iloc.end) return null;
      constructionMethod = view.getUint16(cursor, false) & 0x000f;
      cursor += 2;
    }
    if (cursor + 2 > iloc.end) return null;
    const dataReferenceIndex = view.getUint16(cursor, false);
    cursor += 2;
    const baseOffset = readIsoBmffUnsigned(view, cursor, baseOffsetSize);
    if (baseOffset === null) return null;
    cursor += baseOffsetSize;
    if (cursor + 2 > iloc.end) return null;
    const extentCount = view.getUint16(cursor, false);
    cursor += 2;
    if (extentCount > 65536) return null;

    const extents: HeifItemExtent[] = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if ((version === 1 || version === 2) && indexSize > 0) {
        const extentIndexValue = readIsoBmffUnsigned(view, cursor, indexSize);
        if (extentIndexValue === null) return null;
        cursor += indexSize;
      }
      const extentOffset = readIsoBmffUnsigned(view, cursor, offsetSize);
      if (extentOffset === null) return null;
      cursor += offsetSize;
      const extentLength = readIsoBmffUnsigned(view, cursor, lengthSize);
      if (extentLength === null) return null;
      cursor += lengthSize;
      extents.push({ constructionMethod, dataReferenceIndex, baseOffset, extentOffset, extentLength });
    }
    if (itemId === targetItemId) return extents;
  }
  return null;
}

function extractHeifExifItem(view: DataView): Uint8Array | null {
  if (!isHeifContainer(view)) return null;
  const topLevel = readIsoBmffBoxes(view, 0, view.byteLength);
  const meta = topLevel.find((box) => box.type === "meta");
  if (!meta || meta.contentStart + 4 > meta.end) return null;
  const metaChildren = readIsoBmffBoxes(view, meta.contentStart + 4, meta.end);
  const iinf = metaChildren.find((box) => box.type === "iinf");
  const iloc = metaChildren.find((box) => box.type === "iloc");
  if (!iinf || !iloc) return null;
  const exifItemId = findHeifExifItemId(view, iinf);
  if (exifItemId === null) return null;
  const extents = findHeifItemExtents(view, iloc, exifItemId);
  if (!extents?.length) return null;
  const idat = metaChildren.find((box) => box.type === "idat");
  const parts: Uint8Array[] = [];
  let totalLength = 0;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  for (const extent of extents) {
    if (extent.dataReferenceIndex !== 0 || extent.extentLength <= 0) return null;
    let start: number;
    if (extent.constructionMethod === 0) {
      start = extent.baseOffset + extent.extentOffset;
    } else if (extent.constructionMethod === 1 && idat) {
      start = idat.contentStart + extent.baseOffset + extent.extentOffset;
    } else {
      return null;
    }
    const end = start + extent.extentLength;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > view.byteLength) return null;
    parts.push(bytes.slice(start, end));
    totalLength += extent.extentLength;
    if (!Number.isSafeInteger(totalLength) || totalLength > view.byteLength) return null;
  }
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function parseHeifExifMetadata(view: DataView): PreservedImageMetadata | null {
  const item = extractHeifExifItem(view);
  if (!item || item.byteLength < 8) return null;
  const itemView = new DataView(item.buffer, item.byteOffset, item.byteLength);
  const tiffOffset = itemView.getUint32(0, false);
  const specifiedStart = 4 + tiffOffset;
  const candidates = [specifiedStart, 4];
  for (const candidate of candidates) {
    if (candidate < 0 || candidate >= item.byteLength) continue;
    let start = candidate;
    if (item.byteLength - start >= 6 && readAscii(itemView, start, 6) === "Exif\0\0") start += 6;
    const metadata = parseExifTiffMetadata(item, start, item.byteLength - start);
    if (metadata) return metadata;
  }
  return null;
}

export function extractWhitelistedMetadataFromBuffer(
  buffer: ArrayBuffer | ArrayBufferView,
): PreservedImageMetadata | null {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const jpeg = findJpegExifRange(view);
  if (jpeg) return parseExifTiffMetadata(bytes, jpeg.start, jpeg.length);
  const png = findPngExifRange(view);
  if (png) return parseExifTiffMetadata(bytes, png.start, png.length);
  const webp = findWebPExifRange(view);
  if (webp) return parseExifTiffMetadata(bytes, webp.start, webp.length);
  const heif = parseHeifExifMetadata(view);
  if (heif) return heif;
  return parseExifTiffMetadata(bytes, 0, bytes.byteLength);
}

function rawMetadataString(value: unknown): string | undefined {
  return cleanAscii(value);
}

function arrayLikeTriple(value: unknown): [number, number, number] | null {
  if (!value || typeof value !== "object" || !("length" in value)) return null;
  const list = value as ArrayLike<unknown>;
  if (list.length < 3) return null;
  const a = finiteNumber(list[0]);
  const b = finiteNumber(list[1]);
  const c = finiteNumber(list[2]);
  if (a === undefined || b === undefined || c === undefined) return null;
  return [a, b, c];
}

function rawDmsToDegrees(values: [number, number, number]): number {
  return Math.abs(values[0]) + Math.abs(values[1]) / 60 + Math.abs(values[2]) / 3600;
}

function rawGpsRefSign(value: unknown, negativeRef: string): number {
  if (typeof value === "number") {
    const text = String.fromCharCode(value & 0xff).toUpperCase();
    return text === negativeRef ? -1 : 1;
  }
  const text = String(value ?? "").trim().toUpperCase();
  return text === negativeRef ? -1 : 1;
}

function gpsFromLibRaw(value: unknown): PreservedGpsMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const gps = value as Record<string, unknown>;
  const parsed = gps.gpsparsed;
  if (parsed === 0 || parsed === false || parsed === "\0") return undefined;
  const latitudeDms = arrayLikeTriple(gps.latitude);
  const longitudeDms = arrayLikeTriple(gps.longitude ?? gps.longtitude);
  if (!latitudeDms || !longitudeDms) return undefined;
  const latitude = rawDmsToDegrees(latitudeDms) * rawGpsRefSign(gps.latref, "S");
  const longitude = rawDmsToDegrees(longitudeDms) * rawGpsRefSign(gps.longref, "W");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }
  const altitudeValue = finiteNumber(gps.altitude);
  const altitudeNegative = gps.altref === 1 || gps.altref === "1" || String(gps.altref ?? "").charCodeAt(0) === 1;
  const altitude = altitudeValue === undefined
    ? undefined
    : Math.abs(altitudeValue) * (altitudeNegative ? -1 : 1);
  return { latitude, longitude, altitude };
}

function formatLibRawTimestamp(value: unknown): string | undefined {
  let milliseconds: number | undefined;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else {
    const numeric = finiteNumber(value);
    if (numeric !== undefined && numeric > 0) {
      // libraw-wasm 1.6.0 returns a Date, while older/direct wrappers may expose
      // LibRaw's time_t as epoch seconds. Also accept epoch milliseconds so the
      // metadata boundary remains robust across wrapper implementations.
      milliseconds = numeric >= 100_000_000_000 ? numeric : numeric * 1000;
    }
  }
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return undefined;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${String(year).padStart(4, "0")}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function extractWhitelistedMetadataFromLibRaw(
  metadata: LibRawMetadataLike | undefined,
): PreservedImageMetadata | null {
  if (!metadata) return null;
  const dynamic = metadata as LibRawMetadataLike & Record<string, unknown>;
  const lens = metadata.lens;
  const makerNotes = lens?.makernotes;
  const timestamp = dynamic.timestamp ?? dynamic.timeStamp ?? dynamic.date_time;
  const output: PreservedImageMetadata = {
    dateTimeOriginal: rawMetadataString(dynamic.datetime ?? dynamic.dateTimeOriginal) ?? formatLibRawTimestamp(timestamp),
    make: rawMetadataString(metadata.normalized_make) ?? rawMetadataString(metadata.camera_make),
    model: rawMetadataString(metadata.normalized_model) ?? rawMetadataString(metadata.camera_model),
    lensMake: rawMetadataString(lens?.LensMake),
    lensModel: rawMetadataString(lens?.Lens) ?? rawMetadataString(makerNotes?.Lens),
    focalLength: positiveNumber(metadata.focal_len ?? makerNotes?.CurFocal),
    exposureTime: positiveNumber(metadata.shutter),
    fNumber: positiveNumber(metadata.aperture ?? makerNotes?.CurAp),
    iso: positiveNumber(metadata.iso_speed),
    artist: rawMetadataString(dynamic.artist),
    imageDescription: rawMetadataString(dynamic.desc ?? dynamic.description),
    gps: gpsFromLibRaw(dynamic.parsed_gps),
  };
  return compactMetadata(output);
}

export async function extractWhitelistedMetadata(file: Blob): Promise<PreservedImageMetadata | null> {
  const buffer = await file.arrayBuffer();
  return extractWhitelistedMetadataFromBuffer(buffer);
}

function preferEmbeddedMetadata(
  embedded: PreservedImageMetadata | null,
  fallback: PreservedImageMetadata | null,
): PreservedImageMetadata | null {
  if (!embedded) return fallback;
  if (!fallback) return embedded;
  return compactMetadata({ ...fallback, ...embedded, gps: embedded.gps ?? fallback.gps });
}

export async function extractWhitelistedMetadataFromFile(file: File): Promise<PreservedImageMetadata | null> {
  const buffer = await file.arrayBuffer();
  const embedded = extractWhitelistedMetadataFromBuffer(buffer);
  if (!isRawImageFile(file.name, file.type)) return embedded;

  let raw = null;
  let workerFailure = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    await Promise.race([raw.open(new Uint8Array(buffer)), workerFailure.promise]);
    const metadata = await Promise.race([raw.metadata(true), workerFailure.promise]);
    return preferEmbeddedMetadata(embedded, extractWhitelistedMetadataFromLibRaw(metadata));
  } catch {
    return embedded;
  } finally {
    workerFailure?.cleanup?.();
    raw?.dispose?.();
  }
}

function compactMetadata(metadata: PreservedImageMetadata): PreservedImageMetadata | null {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return entries.length > 0 ? Object.fromEntries(entries) as PreservedImageMetadata : null;
}

function normalizedString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function numbersEqual(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= 1e-9 * scale;
}

function allSameString(values: PreservedImageMetadata[], key: keyof PreservedImageMetadata): string | undefined {
  const first = normalizedString(values[0]?.[key] as string | undefined);
  if (!first) return undefined;
  for (let index = 1; index < values.length; index += 1) {
    if (normalizedString(values[index]?.[key] as string | undefined) !== first) return undefined;
  }
  return first;
}

function allSameNumber(values: PreservedImageMetadata[], key: keyof PreservedImageMetadata): number | undefined {
  const first = values[0]?.[key];
  if (typeof first !== "number" || !Number.isFinite(first)) return undefined;
  for (let index = 1; index < values.length; index += 1) {
    const next = values[index]?.[key];
    if (typeof next !== "number" || !Number.isFinite(next) || !numbersEqual(first, next)) return undefined;
  }
  return first;
}

function gpsClose(left: PreservedGpsMetadata, right: PreservedGpsMetadata): boolean {
  if (Math.abs(left.latitude - right.latitude) > 1e-5) return false;
  if (Math.abs(left.longitude - right.longitude) > 1e-5) return false;
  if (left.altitude === undefined || right.altitude === undefined) return left.altitude === right.altitude;
  return Math.abs(left.altitude - right.altitude) <= 1;
}

function commonGps(values: PreservedImageMetadata[]): PreservedGpsMetadata | undefined {
  const first = values[0]?.gps;
  if (!first) return undefined;
  for (let index = 1; index < values.length; index += 1) {
    const next = values[index]?.gps;
    if (!next || !gpsClose(first, next)) return undefined;
  }
  return { ...first };
}

function parseExifLocalTimestamp(metadata: PreservedImageMetadata): number | null {
  const text = metadata.dateTimeOriginal;
  if (!text) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  let milliseconds = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const subSec = metadata.subSecTimeOriginal?.match(/^\d+/)?.[0];
  if (subSec) milliseconds += Number(`0.${subSec}`) * 1000;
  const offset = metadata.offsetTimeOriginal?.match(/^([+-])(\d{2}):(\d{2})$/);
  if (offset) {
    const minutes = Number(offset[2]) * 60 + Number(offset[3]);
    milliseconds -= (offset[1] === "+" ? 1 : -1) * minutes * 60_000;
  }
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function earliestMetadata(values: PreservedImageMetadata[]): PreservedImageMetadata | undefined {
  let best: PreservedImageMetadata | undefined;
  let bestTime = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (!value.dateTimeOriginal) continue;
    const parsed = parseExifLocalTimestamp(value);
    if (parsed !== null) {
      if (parsed < bestTime) {
        best = value;
        bestTime = parsed;
      }
      continue;
    }
    if (!best || value.dateTimeOriginal < (best.dateTimeOriginal || "")) best = value;
  }
  return best;
}

export function mergeStackMetadata(
  metadataItems: Array<PreservedImageMetadata | null | undefined>,
): PreservedImageMetadata | null {
  if (metadataItems.length === 0 || metadataItems.some((value) => !value)) return null;
  const values = metadataItems as PreservedImageMetadata[];
  const earliest = earliestMetadata(values);
  const output: PreservedImageMetadata = {
    ...(earliest?.dateTimeOriginal ? { dateTimeOriginal: earliest.dateTimeOriginal } : {}),
    ...(earliest?.subSecTimeOriginal ? { subSecTimeOriginal: earliest.subSecTimeOriginal } : {}),
    ...(earliest?.offsetTimeOriginal ? { offsetTimeOriginal: earliest.offsetTimeOriginal } : {}),
    ...(earliest?.dateTimeDigitized ? { dateTimeDigitized: earliest.dateTimeDigitized } : {}),
  };

  const stringKeys: Array<keyof PreservedImageMetadata> = [
    "make", "model", "lensMake", "lensModel", "artist", "copyright", "imageDescription",
  ];
  for (const key of stringKeys) {
    const value = allSameString(values, key);
    if (value !== undefined) (output as Record<string, unknown>)[key] = value;
  }

  const numberKeys: Array<keyof PreservedImageMetadata> = [
    "focalLength", "exposureTime", "fNumber", "iso", "exposureBiasValue", "meteringMode", "flash", "exposureProgram",
  ];
  for (const key of numberKeys) {
    const value = allSameNumber(values, key);
    if (value !== undefined) (output as Record<string, unknown>)[key] = value;
  }

  const gps = commonGps(values);
  if (gps) output.gps = gps;
  return compactMetadata(output);
}

function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function rationalPair(value: number, signed = false): [number, number] {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const denominator = 1_000_000;
  let numerator = Math.round(abs * denominator) * sign;
  let den = denominator;
  const divisor = gcd(numerator, den);
  numerator /= divisor;
  den /= divisor;
  if (signed) {
    const limit = 0x7fffffff;
    if (Math.abs(numerator) > limit) {
      const scale = Math.ceil(Math.abs(numerator) / limit);
      numerator = Math.round(numerator / scale);
      den = Math.max(1, Math.round(den / scale));
    }
  } else {
    numerator = Math.max(0, numerator);
  }
  return [numerator, den];
}

function degreesToDms(value: number): number[] {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return [degrees, minutes, seconds];
}

type BuildEntry = {
  tag: number;
  type: number;
  count: number;
  bytes: Uint8Array;
};

function shortBytes(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, Math.max(0, Math.min(0xffff, Math.round(value))), true);
  return bytes;
}

function longBytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Math.max(0, Math.round(value)) >>> 0, true);
  return bytes;
}

function byteBytes(values: number[]): Uint8Array {
  return Uint8Array.from(values.map((value) => Math.max(0, Math.min(255, Math.round(value)))));
}

function rationalBytes(values: number[], signed = false): Uint8Array {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const [numerator, denominator] = rationalPair(value, signed);
    if (signed) {
      view.setInt32(index * 8, numerator, true);
      view.setInt32(index * 8 + 4, denominator, true);
    } else {
      view.setUint32(index * 8, numerator >>> 0, true);
      view.setUint32(index * 8 + 4, denominator >>> 0, true);
    }
  });
  return bytes;
}

function makeAsciiEntry(tag: number, value: string | undefined): BuildEntry | null {
  const text = cleanAscii(value);
  if (!text) return null;
  const bytes = encodeAscii(text);
  return { tag, type: 2, count: bytes.length, bytes };
}

function makeShortEntry(tag: number, value: number | undefined): BuildEntry | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return { tag, type: 3, count: 1, bytes: shortBytes(value) };
}

function makeLongEntry(tag: number, value: number | undefined): BuildEntry | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return { tag, type: 4, count: 1, bytes: longBytes(value) };
}

function makeIsoEntry(tag: number, value: number | undefined): BuildEntry | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return value <= 0xffff ? makeShortEntry(tag, value) : makeLongEntry(tag, value);
}

function makeRationalEntry(tag: number, value: number | undefined, signed = false): BuildEntry | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return { tag, type: signed ? 10 : 5, count: 1, bytes: rationalBytes([value], signed) };
}

function appendEntry(entries: BuildEntry[], entry: BuildEntry | null): void {
  if (entry) entries.push(entry);
}

function writeIfd(
  output: Uint8Array,
  offset: number,
  entries: BuildEntry[],
  dataCursor: { value: number },
): void {
  entries.sort((left, right) => left.tag - right.tag);
  const view = new DataView(output.buffer);
  view.setUint16(offset, entries.length, true);
  let entryOffset = offset + 2;
  for (const entry of entries) {
    view.setUint16(entryOffset, entry.tag, true);
    view.setUint16(entryOffset + 2, entry.type, true);
    view.setUint32(entryOffset + 4, entry.count, true);
    if (entry.bytes.length <= 4) {
      output.fill(0, entryOffset + 8, entryOffset + 12);
      output.set(entry.bytes, entryOffset + 8);
    } else {
      dataCursor.value = (dataCursor.value + 1) & ~1;
      view.setUint32(entryOffset + 8, dataCursor.value, true);
      output.set(entry.bytes, dataCursor.value);
      dataCursor.value += entry.bytes.length;
    }
    entryOffset += 12;
  }
  view.setUint32(entryOffset, 0, true);
}

function estimateIfdDataBytes(entries: BuildEntry[]): number {
  let total = 0;
  for (const entry of entries) if (entry.bytes.length > 4) total += ((entry.bytes.length + 1) & ~1);
  return total;
}

export function buildExifTiffPayload(metadata: PreservedImageMetadata | null | undefined): Uint8Array | null {
  if (!metadata) return null;
  const ifd0: BuildEntry[] = [];
  const exif: BuildEntry[] = [];
  const gps: BuildEntry[] = [];

  appendEntry(ifd0, makeAsciiEntry(0x010e, metadata.imageDescription));
  appendEntry(ifd0, makeAsciiEntry(0x010f, metadata.make));
  appendEntry(ifd0, makeAsciiEntry(0x0110, metadata.model));
  appendEntry(ifd0, makeShortEntry(0x0112, 1)); // generated output is always physically upright
  appendEntry(ifd0, makeAsciiEntry(0x013b, metadata.artist));
  appendEntry(ifd0, makeAsciiEntry(0x8298, metadata.copyright));

  appendEntry(exif, makeRationalEntry(0x829a, metadata.exposureTime));
  appendEntry(exif, makeRationalEntry(0x829d, metadata.fNumber));
  appendEntry(exif, makeShortEntry(0x8822, metadata.exposureProgram));
  appendEntry(exif, makeIsoEntry(0x8827, metadata.iso));
  appendEntry(exif, makeAsciiEntry(0x9003, metadata.dateTimeOriginal));
  appendEntry(exif, makeAsciiEntry(0x9004, metadata.dateTimeDigitized));
  appendEntry(exif, makeAsciiEntry(0x9011, metadata.offsetTimeOriginal));
  appendEntry(exif, makeRationalEntry(0x9204, metadata.exposureBiasValue, true));
  appendEntry(exif, makeShortEntry(0x9207, metadata.meteringMode));
  appendEntry(exif, makeShortEntry(0x9209, metadata.flash));
  appendEntry(exif, makeRationalEntry(0x920a, metadata.focalLength));
  appendEntry(exif, makeAsciiEntry(0x9291, metadata.subSecTimeOriginal));
  appendEntry(exif, makeAsciiEntry(0xa433, metadata.lensMake));
  appendEntry(exif, makeAsciiEntry(0xa434, metadata.lensModel));

  if (metadata.gps && Number.isFinite(metadata.gps.latitude) && Number.isFinite(metadata.gps.longitude)) {
    gps.push({ tag: 0x0000, type: 1, count: 4, bytes: byteBytes([2, 3, 0, 0]) });
    appendEntry(gps, makeAsciiEntry(0x0001, metadata.gps.latitude < 0 ? "S" : "N"));
    gps.push({ tag: 0x0002, type: 5, count: 3, bytes: rationalBytes(degreesToDms(metadata.gps.latitude)) });
    appendEntry(gps, makeAsciiEntry(0x0003, metadata.gps.longitude < 0 ? "W" : "E"));
    gps.push({ tag: 0x0004, type: 5, count: 3, bytes: rationalBytes(degreesToDms(metadata.gps.longitude)) });
    if (metadata.gps.altitude !== undefined && Number.isFinite(metadata.gps.altitude)) {
      gps.push({ tag: 0x0005, type: 1, count: 1, bytes: byteBytes([metadata.gps.altitude < 0 ? 1 : 0]) });
      gps.push({ tag: 0x0006, type: 5, count: 1, bytes: rationalBytes([Math.abs(metadata.gps.altitude)]) });
    }
  }

  if (exif.length > 0) ifd0.push({ tag: 0x8769, type: 4, count: 1, bytes: longBytes(0) });
  if (gps.length > 0) ifd0.push({ tag: 0x8825, type: 4, count: 1, bytes: longBytes(0) });

  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const exifOffset = exif.length > 0 ? ((ifd0Offset + ifd0Size + 1) & ~1) : 0;
  const exifSize = exif.length > 0 ? 2 + exif.length * 12 + 4 : 0;
  const gpsOffset = gps.length > 0 ? (((exifOffset || (ifd0Offset + ifd0Size)) + exifSize + 1) & ~1) : 0;
  const gpsSize = gps.length > 0 ? 2 + gps.length * 12 + 4 : 0;
  let dataStart = gps.length > 0
    ? gpsOffset + gpsSize
    : exif.length > 0
      ? exifOffset + exifSize
      : ifd0Offset + ifd0Size;
  dataStart = (dataStart + 1) & ~1;

  const totalSize = dataStart + estimateIfdDataBytes(ifd0) + estimateIfdDataBytes(exif) + estimateIfdDataBytes(gps) + 16;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0Offset, true);

  for (const entry of ifd0) {
    if (entry.tag === 0x8769) entry.bytes = longBytes(exifOffset);
    if (entry.tag === 0x8825) entry.bytes = longBytes(gpsOffset);
  }

  const dataCursor = { value: dataStart };
  writeIfd(output, ifd0Offset, ifd0, dataCursor);
  if (exif.length > 0) writeIfd(output, exifOffset, exif, dataCursor);
  if (gps.length > 0) writeIfd(output, gpsOffset, gps, dataCursor);
  return output.slice(0, dataCursor.value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function jpegWithExif(bytes: Uint8Array, exifTiff: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const prefix = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const payload = concatBytes([prefix, exifTiff]);
  if (payload.length + 2 > 0xffff) return bytes;
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  new DataView(segment.buffer).setUint16(2, payload.length + 2, false);
  segment.set(payload, 4);

  const parts: Uint8Array[] = [bytes.subarray(0, 2), segment];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    let markerOffset = offset;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= bytes.length) break;
    const marker = bytes[markerOffset];
    if (marker === 0xda || marker === 0xd9) break;
    const lengthOffset = markerOffset + 1;
    if (lengthOffset + 2 > bytes.length) break;
    const segmentLength = (bytes[lengthOffset] << 8) | bytes[lengthOffset + 1];
    if (segmentLength < 2 || lengthOffset + segmentLength > bytes.length) break;
    const end = lengthOffset + segmentLength;
    const dataStart = lengthOffset + 2;
    const isExif = marker === 0xe1 && end - dataStart >= 6 &&
      String.fromCharCode(...bytes.subarray(dataStart, dataStart + 6)) === "Exif\0\0";
    if (!isExif) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  return concatBytes(parts);
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)), false);
  return output;
}

function pngWithExif(bytes: Uint8Array, exifTiff: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isPng(view)) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) return bytes;
    if (type !== "eXIf") parts.push(bytes.subarray(offset, end));
    if (!inserted && type === "IHDR") {
      parts.push(pngChunk("eXIf", exifTiff));
      inserted = true;
    }
    offset = end;
  }
  if (offset < bytes.length) parts.push(bytes.subarray(offset));
  return concatBytes(parts);
}

function uint24Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function webpChunk(type: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length + (payload.length & 1);
  const output = new Uint8Array(8 + padded);
  for (let index = 0; index < 4; index += 1) output[index] = type.charCodeAt(index);
  new DataView(output.buffer).setUint32(4, payload.length, true);
  output.set(payload, 8);
  return output;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number; alpha: boolean } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) break;
    if (type === "VP8X" && length >= 10) {
      const width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
      const height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      return { width, height, alpha: (bytes[start] & 0x10) !== 0 };
    }
    if (type === "VP8 " && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      const width = (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3fff;
      const height = (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3fff;
      return { width, height, alpha: false };
    }
    if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
      const bits = bytes[start + 1] | (bytes[start + 2] << 8) | (bytes[start + 3] << 16) | (bytes[start + 4] << 24);
      const width = 1 + (bits & 0x3fff);
      const height = 1 + ((bits >>> 14) & 0x3fff);
      const alpha = ((bits >>> 28) & 1) !== 0;
      return { width, height, alpha };
    }
    offset = start + length + (length & 1);
  }
  return null;
}

function webpWithExif(bytes: Uint8Array, exifTiff: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isWebP(view)) return bytes;
  const dimensions = webpDimensions(bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 0x1000000 || dimensions.height > 0x1000000) return bytes;

  const chunks: Array<{ type: string; raw: Uint8Array; payload: Uint8Array }> = [];
  let offset = 12;
  let vp8xFlags = 0;
  while (offset + 8 <= bytes.length) {
    const type = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length + (length & 1);
    if (end > bytes.length) return bytes;
    const payload = bytes.subarray(start, start + length);
    if (type === "VP8X" && length >= 10) vp8xFlags = payload[0];
    if (type !== "EXIF" && type !== "VP8X") chunks.push({ type, raw: bytes.subarray(offset, end), payload });
    offset = end;
  }

  let flags = vp8xFlags | 0x08;
  if (dimensions.alpha || chunks.some((chunk) => chunk.type === "ALPH")) flags |= 0x10;
  if (chunks.some((chunk) => chunk.type === "ICCP")) flags |= 0x20;
  if (chunks.some((chunk) => chunk.type === "XMP ")) flags |= 0x04;
  if (chunks.some((chunk) => chunk.type === "ANIM" || chunk.type === "ANMF")) flags |= 0x02;

  const vp8x = new Uint8Array(10);
  vp8x[0] = flags;
  uint24Le(vp8x, 4, dimensions.width - 1);
  uint24Le(vp8x, 7, dimensions.height - 1);

  // WebP EXIF chunks contain the TIFF/Exif payload directly. The JPEG APP1
  // "Exif\0\0" segment identifier is not part of a WebP EXIF chunk.
  const exifChunk = webpChunk("EXIF", exifTiff);
  const bodyParts: Uint8Array[] = [webpChunk("VP8X", vp8x)];
  let exifInserted = false;
  for (const chunk of chunks) {
    if (!exifInserted && chunk.type === "XMP ") {
      bodyParts.push(exifChunk);
      exifInserted = true;
    }
    bodyParts.push(chunk.raw);
  }
  if (!exifInserted) bodyParts.push(exifChunk);
  const body = concatBytes(bodyParts);
  const output = new Uint8Array(12 + body.length);
  output.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  output.set([0x57, 0x45, 0x42, 0x50], 8);
  output.set(body, 12);
  return output;
}

export async function attachWhitelistedMetadata(
  blob: Blob,
  metadata: PreservedImageMetadata | null | undefined,
): Promise<Blob> {
  const exifTiff = buildExifTiffPayload(metadata);
  if (!exifTiff) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type.toLowerCase();
  let output: Uint8Array<ArrayBufferLike> = bytes;
  if (mime === "image/jpeg" || mime === "image/jpg") {
    output = jpegWithExif(bytes, exifTiff);
  } else if (mime === "image/png") {
    output = pngWithExif(bytes, exifTiff);
  } else if (mime === "image/webp") {
    output = webpWithExif(bytes, exifTiff);
  }
  if (output === bytes) return blob;
  const blobBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(blobBuffer).set(output);
  return new Blob([blobBuffer], { type: blob.type });
}
